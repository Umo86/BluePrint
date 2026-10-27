import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { qualified } from '../db/qualified';
import { files, orderLines, orders, standContractors, stands, type EditionPermission, type FILE_PURPOSES } from '../db/schema';
import {
  assertWritable,
  getEditionAccess,
  getMemberships,
  inViewedEdition,
  isViewingAs,
  membershipCovers,
  requireContractorStand,
  requireEditionPermission,
  requireStandAccess,
  supplierIdsFor,
  type EditionAccess,
} from '../authz';
import { AppError, forbidden, invalid, notFound } from '../errors';
import { audit } from '../audit';
import { assertRateLimit } from '../security/rate-limit';
import { PRACTICE_KEY_PREFIX, PRACTICE_MAX_BYTES, PRACTICE_TOTAL_BYTES, STORAGE_OFF_MESSAGE, practiceStorage, storage, storageForKey } from '../storage';
import { isDemoScope } from '../demo/flags';
import type { Actor } from '../auth/actor';
import { DRAWING_TYPES, UPLOAD_RULES, typeFromName } from '@/lib/upload-rules';

export type FilePurpose = (typeof FILE_PURPOSES)[number];
export type FileRow = typeof files.$inferSelect;

const DRAWINGS = DRAWING_TYPES;
export { UPLOAD_RULES };

const UPLOADABLE: FilePurpose[] = ['branding', 'company_logo', 'product', 'manual', 'submission', 'space_only', 'ticket', 'order'];

export const beginUploadSchema = z.object({
  purpose: z.enum(UPLOADABLE as [FilePurpose, ...FilePurpose[]]),
  filename: z.string().trim().min(1).max(200),
  contentType: z.string().max(150),
  size: z.number().int().positive(),
  editionId: z.string().uuid().optional(),
  standId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
});

type Scope = { editionId: string | null; companyId: string | null; standId: string | null; supplierId: string | null };

/** Checks the actor may upload this kind of file for this place, and works out the full scope. */
async function authorizeUpload(actor: Actor, input: z.infer<typeof beginUploadSchema>): Promise<Scope> {
  assertWritable(actor);
  const db = await getDb();
  switch (input.purpose) {
    case 'branding':
    case 'manual': {
      if (!input.editionId) throw invalid('Choose the show.');
      await requireEditionPermission(actor, input.editionId, 'edit_content', { write: true });
      return { editionId: input.editionId, companyId: null, standId: null, supplierId: null };
    }
    case 'product': {
      if (input.supplierId) {
        const mine = await supplierIdsFor(actor);
        if (!mine.includes(input.supplierId) && !(actor.isSuperAdmin && !actor.readOnly)) {
          if (!input.editionId) throw notFound();
          await requireEditionPermission(actor, input.editionId, 'manage_orders', { write: true });
        }
        return { editionId: input.editionId ?? null, companyId: null, standId: null, supplierId: input.supplierId };
      }
      if (!input.editionId) throw invalid('Choose the show.');
      await requireEditionPermission(actor, input.editionId, 'manage_orders', { write: true });
      return { editionId: input.editionId, companyId: null, standId: null, supplierId: null };
    }
    case 'company_logo': {
      if (!input.companyId) throw invalid('Choose the company.');
      const memberships = await getMemberships(actor);
      if (memberships.some((m) => m.companyId === input.companyId)) {
        return { editionId: null, companyId: input.companyId, standId: null, supplierId: null };
      }
      if (!input.editionId) throw notFound();
      await requireEditionPermission(actor, input.editionId, 'manage_exhibitors', { write: true });
      return { editionId: input.editionId, companyId: input.companyId, standId: null, supplierId: null };
    }
    case 'submission':
    case 'space_only':
    case 'ticket':
    case 'order': {
      if (!input.standId) throw invalid('Choose the stand.');
      const [stand] = await db.select().from(stands).where(eq(stands.id, input.standId)).limit(1);
      if (!stand) throw notFound();
      const scope = { editionId: stand.editionId, companyId: stand.companyId, standId: stand.id, supplierId: null };
      const staff = await getEditionAccess(actor, stand.editionId);
      if (staff) {
        const needed =
          input.purpose === 'space_only' ? 'review_space_only' : input.purpose === 'ticket' ? 'helpdesk' : input.purpose === 'order' ? 'manage_orders' : 'manage_exhibitors';
        if (!staff.permissions.has(needed)) throw forbidden();
        assertWritable(actor);
        return scope;
      }
      if (input.purpose === 'space_only') {
        const [c] = await db
          .select()
          .from(standContractors)
          .where(and(eq(standContractors.standId, stand.id), eq(standContractors.userId, actor.userId), eq(standContractors.status, 'active')))
          .limit(1);
        if (c) {
          await requireContractorStand(actor, stand.id, { write: true });
          return scope;
        }
      }
      await requireStandAccess(actor, stand.id, { write: true });
      return scope;
    }
    default:
      throw forbidden();
  }
}

/**
 * Starts an upload: checks permission, size and declared type, and returns where the browser
 * should send the bytes. Nothing is usable until `completeUpload` has checked the real content.
 */
export async function beginUpload(actor: Actor, raw: z.input<typeof beginUploadSchema>) {
  const input = beginUploadSchema.parse(raw);
  const rules = UPLOAD_RULES[input.purpose];
  if (input.size > rules.maxBytes) throw invalid(`That file is too big. Allowed: ${rules.label}.`);
  const acceptsDrawings = rules.types.includes('image/vnd.dwg');
  // Browsers rarely know what a DWG, EPS or Photoshop file is, so go by the name for now; the real bytes are checked on completion.
  const given = input.contentType.toLowerCase();
  const byName = typeFromName(input.filename);
  const declared =
    acceptsDrawings && /\.dwg$/i.test(input.filename) ? 'image/vnd.dwg' : !rules.types.includes(given) && byName && rules.types.includes(byName) ? byName : given;
  if (!rules.types.includes(declared)) throw invalid(`That type of file isn’t accepted here. Allowed: ${rules.label}.`);
  await assertRateLimit(`upload:${actor.realUserId}`, 200, 3600);
  const scope = await authorizeUpload(actor, input);
  // Without file storage, only the demo shows can upload: their files are kept in the database.
  const practice = storage().kind === 'off' && (await isDemoScope(scope));
  if (storage().kind === 'off' && !practice) throw new AppError(STORAGE_OFF_MESSAGE, 'unavailable');
  if (practice) {
    if (input.size > PRACTICE_MAX_BYTES) throw invalid('That file is too big for the demo shows: up to 4 MB each while file storage is not connected.');
    // The test logins are public, so the database never fills up with demo files.
    const db = await getDb();
    const [{ used }] = await db
      .select({ used: sql<number>`coalesce(sum(${files.sizeBytes}), 0)::bigint` })
      .from(files)
      .where(and(sql`${files.storageKey} like ${PRACTICE_KEY_PREFIX + '%'}`, isNull(files.deletedAt)));
    if (Number(used) + input.size > PRACTICE_TOTAL_BYTES) {
      throw new AppError('The demo shows have no room for more files. A super admin can start the demo again to clear them.', 'unavailable');
    }
    await assertRateLimit(`practice-upload:${actor.realUserId}`, 40, 3600);
  }

  const db = await getDb();
  const id = randomUUID();
  const key = `${practice ? PRACTICE_KEY_PREFIX : ''}${input.purpose}/${new Date().toISOString().slice(0, 7)}/${id}`;
  const [row] = await db
    .insert(files)
    .values({
      id,
      storageKey: key,
      originalName: input.filename.replace(/[\u0000-\u001f\u007f/\\]/g, '_'),
      mimeType: declared,
      sizeBytes: input.size,
      sha256: '',
      purpose: input.purpose,
      ...scope,
      isPublic: rules.isPublic,
      uploadedBy: actor.realUserId,
    })
    .returning();

  const s = storageForKey(key);
  const uploadUrl = s.presignPut ? await s.presignPut(key, declared, 600) : `/api/files/upload/${row.id}`;
  return { fileId: row.id, uploadUrl, contentType: declared };
}

/**
 * Receives the bytes for a pending upload that does not go straight to R2: local development, and
 * demo-show files kept in the database. Anything else is "not found".
 */
export async function receiveLocalUpload(actor: Actor, fileId: string, body: Uint8Array) {
  const db = await getDb();
  const [row] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!row || row.verifiedAt || row.deletedAt || row.uploadedBy !== actor.realUserId) throw notFound();
  const s = storageForKey(row.storageKey);
  if (s.kind !== 'local' && s.kind !== 'database') throw notFound();
  if (body.byteLength > UPLOAD_RULES[row.purpose].maxBytes) throw invalid('That file is too big.');
  if (s.kind === 'database' && body.byteLength > PRACTICE_MAX_BYTES) throw invalid('That file is too big for the demo shows: up to 4 MB each.');
  await s.put(row.storageKey, body, row.mimeType);
}

async function sniffType(key: string): Promise<string | null> {
  const head = await storageForKey(key).readStart(key, 512 * 1024);
  if (head.byteLength >= 6 && /^AC10\d\d$/.test(Buffer.from(head.subarray(0, 6)).toString('latin1'))) return 'image/vnd.dwg';
  const { fileTypeFromBuffer } = await import('file-type');
  const t = await fileTypeFromBuffer(head);
  return t?.mime ?? null;
}

async function hashObject(key: string): Promise<string> {
  const stream = await storageForKey(key).stream(key);
  if (!stream) throw notFound();
  const hash = createHash('sha256');
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
  }
  return hash.digest('hex');
}

/**
 * Checks what actually arrived: the real size and the real file type from its first bytes
 * (not the name or what the browser claimed). Anything that fails is deleted.
 */
export async function completeUpload(actor: Actor, fileId: string): Promise<FileRow> {
  const db = await getDb();
  const [row] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!row || row.deletedAt || row.uploadedBy !== actor.realUserId) throw notFound();
  if (row.verifiedAt) return row;
  const rules = UPLOAD_RULES[row.purpose];
  const s = storageForKey(row.storageKey);
  const size = await s.size(row.storageKey);
  const reject = async (message: string) => {
    await s.delete(row.storageKey).catch(() => undefined);
    await db.delete(files).where(eq(files.id, row.id));
    await audit(actor, 'file.rejected', { entityType: 'file', entityId: row.id, editionId: row.editionId, details: { purpose: row.purpose, reason: message } });
    throw invalid(message);
  };
  if (size === null) return reject('The upload did not arrive. Please try again.');
  if (size === 0) return reject('That file is empty.');
  if (size > rules.maxBytes) return reject(`That file is too big. Allowed: ${rules.label}.`);
  const realType = await sniffType(row.storageKey);
  const normalised = realType && DRAWINGS.includes(realType) ? 'image/vnd.dwg' : realType;
  if (!normalised || !rules.types.includes(normalised)) {
    return reject(`That file isn’t what its name says, or isn’t accepted here. Allowed: ${rules.label}.`);
  }
  const sha256 = await hashObject(row.storageKey);
  const [updated] = await db
    .update(files)
    .set({ verifiedAt: new Date(), sizeBytes: size, mimeType: normalised, sha256 })
    .where(eq(files.id, row.id))
    .returning();
  await audit(actor, 'file.uploaded', {
    entityType: 'file',
    entityId: row.id,
    editionId: row.editionId,
    companyId: row.companyId,
    details: { purpose: row.purpose, name: row.originalName, size, type: normalised },
  });
  return updated;
}

/** Stores a file BluePrint made itself (invoices, permission-to-build certificates). */
export async function storeGeneratedFile(input: {
  purpose: 'invoice' | 'certificate';
  filename: string;
  contentType: string;
  body: Uint8Array;
  editionId?: string | null;
  companyId?: string | null;
  standId?: string | null;
  supplierId?: string | null;
}) {
  const id = randomUUID();
  // Without file storage, the demo shows keep their certificates in the database like their uploads.
  const practice = storage().kind === 'off' && (await isDemoScope({ editionId: input.editionId, supplierId: input.supplierId, companyId: input.companyId }));
  const key = `${practice ? PRACTICE_KEY_PREFIX : ''}${input.purpose}/${new Date().toISOString().slice(0, 7)}/${id}`;
  await (practice ? practiceStorage() : storage()).put(key, input.body, input.contentType);
  const db = await getDb();
  const [row] = await db
    .insert(files)
    .values({
      id,
      storageKey: key,
      originalName: input.filename,
      mimeType: input.contentType,
      sizeBytes: input.body.byteLength,
      sha256: createHash('sha256').update(input.body).digest('hex'),
      purpose: input.purpose,
      editionId: input.editionId ?? null,
      companyId: input.companyId ?? null,
      standId: input.standId ?? null,
      supplierId: input.supplierId ?? null,
      isPublic: false,
      verifiedAt: new Date(),
    })
    .returning();
  return row;
}

/**
 * Which uploads a show team member may open: only those that belong to work their permissions cover.
 * Branding, manual downloads, product photos and logos are open to the whole team.
 */
export function staffMayReadFile(staff: EditionAccess, purpose: FilePurpose) {
  const has = (p: EditionPermission) => staff.permissions.has(p);
  switch (purpose) {
    case 'submission':
      return has('manage_exhibitors') || has('helpdesk');
    case 'space_only':
    case 'certificate':
      return has('review_space_only') || has('manage_exhibitors');
    case 'ticket':
      return has('helpdesk') || has('manage_exhibitors');
    case 'invoice':
    case 'order':
      return has('manage_orders') || has('view_reports');
    case 'manual':
    case 'branding':
    case 'product':
    case 'company_logo':
      return staff.role !== 'hs_reviewer' || purpose === 'manual';
  }
}

/** Whether the actor may download a file. Public files (branding, logos, product photos) are open to all. */
export async function canReadFile(actor: Actor | null, file: FileRow): Promise<boolean> {
  if (!file.verifiedAt || file.deletedAt) return false;
  if (file.isPublic) return true;
  if (!actor) return false;
  if (actor.isSuperAdmin && !actor.readOnly) return true;
  if (file.uploadedBy && file.uploadedBy === actor.realUserId && !actor.readOnly) return true;

  const db = await getDb();
  if (file.editionId) {
    const staff = await getEditionAccess(actor, file.editionId);
    if (staff) return staffMayReadFile(staff, file.purpose);
  }
  // Viewing as an exhibitor reaches only the show the admin may view.
  if (file.editionId && !inViewedEdition(actor, file.editionId)) return false;
  // Company files that belong to a show are open to the people who act for the company at that show.
  const memberships = (await getMemberships(actor)).filter((m) => !file.editionId || membershipCovers(m, file.editionId));
  const companyIds = new Set(memberships.map((m) => m.companyId));
  if (file.purpose === 'manual' && file.editionId) {
    // Anyone exhibiting or building at the show can read its manual downloads.
    if (companyIds.size) {
      const own = await db
        .select({ id: stands.id })
        .from(stands)
        .where(and(eq(stands.editionId, file.editionId), eq(stands.status, 'active'), inArray(stands.companyId, [...companyIds])))
        .limit(1);
      if (own.length) return true;
    }
    if (isViewingAs(actor)) return false;
    const contractorStands = await db
      .select({ editionId: stands.editionId })
      .from(standContractors)
      .innerJoin(stands, eq(stands.id, standContractors.standId))
      .where(and(eq(standContractors.userId, actor.userId), eq(standContractors.status, 'active')));
    return contractorStands.some((r) => r.editionId === file.editionId);
  }
  if (file.companyId && companyIds.has(file.companyId)) {
    return ['submission', 'space_only', 'certificate', 'invoice', 'ticket', 'company_logo', 'order'].includes(file.purpose);
  }
  // A supplier opens a file sent with an order (such as artwork) once it is on one of their paid or invoiced order lines.
  if (file.purpose === 'order' && file.standId && !isViewingAs(actor)) {
    const mine = await supplierIdsFor(actor);
    if (mine.length) {
      const [line] = await db
        .select({ id: orderLines.id })
        .from(orderLines)
        .innerJoin(orders, eq(orders.id, orderLines.orderId))
        .where(
          and(
            eq(orders.standId, file.standId),
            inArray(orderLines.supplierId, mine),
            inArray(orders.status, ['paid', 'invoiced', 'partially_refunded']),
            sql`exists (select 1 from jsonb_each(${orderLines.details}) d where d.value ->> 'file' = ${file.id})`,
          ),
        )
        .limit(1);
      if (line) return true;
    }
  }
  if (file.standId && (file.purpose === 'space_only' || file.purpose === 'certificate') && !isViewingAs(actor)) {
    const [c] = await db
      .select()
      .from(standContractors)
      .where(and(eq(standContractors.standId, file.standId), eq(standContractors.userId, actor.userId), eq(standContractors.status, 'active')))
      .limit(1);
    if (c) return true;
  }
  if (file.supplierId && file.purpose === 'invoice') {
    return (await supplierIdsFor(actor)).includes(file.supplierId);
  }
  return false;
}

/**
 * Whether the actor may read an order's VAT invoices and credit notes: the same people who may
 * download them once stored (the exhibitor's team, show team members who handle orders or reports,
 * and super admins).
 */
export async function canReadOrderDocuments(actor: Actor, order: { id: string; editionId: string; companyId: string | null; standId: string }) {
  const now = new Date();
  return canReadFile(actor, {
    id: order.id,
    storageKey: '',
    originalName: '',
    mimeType: 'application/pdf',
    sizeBytes: 0,
    sha256: '',
    purpose: 'invoice',
    editionId: order.editionId,
    companyId: order.companyId,
    standId: order.standId,
    supplierId: null,
    isPublic: false,
    uploadedBy: null,
    verifiedAt: now,
    deletedAt: null,
    createdAt: now,
  });
}

export async function getFile(fileId: string) {
  const db = await getDb();
  const [row] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  return row ?? null;
}

/** A file the actor uploaded (and that passed its checks), for attaching to a form or setting. */
export async function requireOwnVerifiedFile(actor: Actor, fileId: string, purpose: FilePurpose) {
  const row = await getFile(fileId);
  if (!row || row.deletedAt || !row.verifiedAt || row.purpose !== purpose) throw invalid('That upload could not be found. Please upload it again.');
  if (row.uploadedBy !== actor.realUserId && !(actor.isSuperAdmin && !actor.readOnly)) throw invalid('That upload could not be found. Please upload it again.');
  return row;
}

/** Marks a file deleted and removes the stored bytes. */
export async function deleteFile(actor: Actor, fileId: string) {
  const row = await getFile(fileId);
  if (!row || row.deletedAt) return;
  const db = await getDb();
  await db.update(files).set({ deletedAt: new Date() }).where(eq(files.id, fileId));
  await storageForKey(row.storageKey).delete(row.storageKey).catch(() => undefined);
  await audit(actor, 'file.deleted', { entityType: 'file', entityId: fileId, editionId: row.editionId, companyId: row.companyId });
}

/** Housekeeping: removes uploads that were started but never finished. */
export async function purgeAbandonedUploads() {
  const db = await getDb();
  const stale = await db
    .select()
    .from(files)
    .where(and(isNull(files.verifiedAt), lt(files.createdAt, new Date(Date.now() - 24 * 3600 * 1000))))
    .limit(500);
  for (const f of stale) {
    await storageForKey(f.storageKey).delete(f.storageKey).catch(() => undefined);
    await db.delete(files).where(eq(files.id, f.id));
  }
  return { removed: stale.length };
}

/**
 * Housekeeping: removes files sent with basket items that never became part of an order (such as
 * artwork for something taken out of the basket), 30 days after they were uploaded.
 */
export async function purgeUnusedOrderFiles(now = new Date()) {
  const db = await getDb();
  const unused = await db
    .select()
    .from(files)
    .where(
      and(
        eq(files.purpose, 'order'),
        isNull(files.deletedAt),
        lt(files.createdAt, new Date(now.getTime() - 30 * 24 * 3600 * 1000)),
        sql`not exists (select 1 from cart_items c cross join lateral jsonb_each(c.details) d where d.value ->> 'file' = cast(${qualified(files.id)} as text))`,
        sql`not exists (select 1 from order_lines l cross join lateral jsonb_each(l.details) d where d.value ->> 'file' = cast(${qualified(files.id)} as text))`,
      ),
    )
    .limit(500);
  for (const f of unused) {
    await storageForKey(f.storageKey).delete(f.storageKey).catch(() => undefined);
    await db.update(files).set({ deletedAt: now }).where(eq(files.id, f.id));
  }
  return { removed: unused.length };
}

export function fileUrl(fileId: string | null | undefined) {
  return fileId ? `/files/${fileId}` : null;
}
