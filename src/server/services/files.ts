import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { files, standContractors, stands, type EditionPermission, type FILE_PURPOSES } from '../db/schema';
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
import { forbidden, invalid, notFound } from '../errors';
import { audit } from '../audit';
import { assertRateLimit } from '../security/rate-limit';
import { storage } from '../storage';
import type { Actor } from '../auth/actor';
import { DRAWING_TYPES, UPLOAD_RULES } from '@/lib/upload-rules';

export type FilePurpose = (typeof FILE_PURPOSES)[number];
export type FileRow = typeof files.$inferSelect;

const DRAWINGS = DRAWING_TYPES;
export { UPLOAD_RULES };

const UPLOADABLE: FilePurpose[] = ['branding', 'company_logo', 'product', 'manual', 'submission', 'space_only', 'ticket'];

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
    case 'ticket': {
      if (!input.standId) throw invalid('Choose the stand.');
      const [stand] = await db.select().from(stands).where(eq(stands.id, input.standId)).limit(1);
      if (!stand) throw notFound();
      const scope = { editionId: stand.editionId, companyId: stand.companyId, standId: stand.id, supplierId: null };
      const staff = await getEditionAccess(actor, stand.editionId);
      if (staff) {
        const needed = input.purpose === 'space_only' ? 'review_space_only' : input.purpose === 'ticket' ? 'helpdesk' : 'manage_exhibitors';
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
  // Browsers rarely know what a DWG is, so trust the name for now; the real bytes are checked on completion.
  const declared = acceptsDrawings && /\.dwg$/i.test(input.filename) ? 'image/vnd.dwg' : input.contentType.toLowerCase();
  if (!rules.types.includes(declared)) throw invalid(`That type of file isn’t accepted here. Allowed: ${rules.label}.`);
  await assertRateLimit(`upload:${actor.realUserId}`, 200, 3600);
  const scope = await authorizeUpload(actor, input);

  const db = await getDb();
  const id = randomUUID();
  const key = `${input.purpose}/${new Date().toISOString().slice(0, 7)}/${id}`;
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

  const s = storage();
  const uploadUrl = s.presignPut ? await s.presignPut(key, declared, 600) : `/api/files/upload/${row.id}`;
  return { fileId: row.id, uploadUrl, contentType: declared };
}

/** Local development only: receives the bytes for a pending upload. */
export async function receiveLocalUpload(actor: Actor, fileId: string, body: Uint8Array) {
  const db = await getDb();
  const [row] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!row || row.verifiedAt || row.deletedAt || row.uploadedBy !== actor.realUserId) throw notFound();
  if (body.byteLength > UPLOAD_RULES[row.purpose].maxBytes) throw invalid('That file is too big.');
  await storage().put(row.storageKey, body, row.mimeType);
}

async function sniffType(key: string): Promise<string | null> {
  const head = await storage().readStart(key, 512 * 1024);
  if (head.byteLength >= 6 && /^AC10\d\d$/.test(Buffer.from(head.subarray(0, 6)).toString('latin1'))) return 'image/vnd.dwg';
  const { fileTypeFromBuffer } = await import('file-type');
  const t = await fileTypeFromBuffer(head);
  return t?.mime ?? null;
}

async function hashObject(key: string): Promise<string> {
  const stream = await storage().stream(key);
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
  const s = storage();
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
  const key = `${input.purpose}/${new Date().toISOString().slice(0, 7)}/${id}`;
  await storage().put(key, input.body, input.contentType);
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
    return ['submission', 'space_only', 'certificate', 'invoice', 'ticket', 'company_logo'].includes(file.purpose);
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
  await storage().delete(row.storageKey).catch(() => undefined);
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
    await storage().delete(f.storageKey).catch(() => undefined);
    await db.delete(files).where(eq(files.id, f.id));
  }
  return { removed: stale.length };
}

export function fileUrl(fileId: string | null | undefined) {
  return fileId ? `/files/${fileId}` : null;
}
