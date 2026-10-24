import 'server-only';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { companies, companyMembers, editions, exhibitorTypes, halls, invitations, stands } from '../db/schema';
import { requireEditionPermission } from '../authz';
import { conflict, invalid, notFound } from '../errors';
import { audit } from '../audit';
import { createInvitation } from '../auth/invitations';
import { isValidEmail, normaliseEmail } from '../auth/login';
import { assertRateLimit } from '../security/rate-limit';
import { assertSafeZip } from '../security/zip';
import { parseDelimited } from '@/lib/csv-parse';
import type { Actor } from '../auth/actor';

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 5000;

/** Column headings BluePrint recognises (case and punctuation ignored). */
const FIELD_ALIASES: Record<string, string[]> = {
  company: ['company', 'company name', 'exhibitor', 'exhibitor name', 'organisation', 'organization', 'business name'],
  stand: ['stand', 'stand number', 'stand no', 'stand ref', 'booth', 'booth number'],
  type: ['type', 'stand type', 'package', 'exhibitor type', 'stand package'],
  hall: ['hall', 'zone', 'area name'],
  size: ['size', 'sqm', 'size sqm', 'size m2', 'm2', 'area', 'stand size', 'square metres', 'square meters'],
  openSides: ['open sides', 'sides', 'sides open'],
  contactName: ['contact', 'contact name', 'main contact', 'main contact name', 'name'],
  contactEmail: ['email', 'contact email', 'e mail', 'email address', 'main contact email'],
  phone: ['phone', 'telephone', 'tel', 'contact phone', 'mobile', 'phone number'],
  website: ['website', 'web', 'url', 'web address'],
  vatNumber: ['vat', 'vat number', 'vat no'],
  aspExhibitorId: ['exhibitor id', 'asp id', 'asp exhibitor id', 'event website id'],
};

export const IMPORT_COLUMNS = Object.keys(FIELD_ALIASES);

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const normName = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

function mapHeader(header: string[]) {
  const map: Partial<Record<keyof typeof FIELD_ALIASES, number>> = {};
  header.forEach((h, i) => {
    const n = norm(h);
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (map[field] === undefined && aliases.includes(n)) map[field] = i;
    }
  });
  return map;
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((t) => t.text ?? '').join('').trim();
    if ('text' in o) return cellToString(o.text);
    if ('result' in o) return cellToString(o.result);
    if ('hyperlink' in o) return cellToString(String(o.hyperlink).replace(/^mailto:/i, ''));
  }
  return '';
}

/** Reads the first sheet of an .xlsx file, or a CSV / tab-separated text file, into rows. */
export async function readSpreadsheet(name: string, bytes: Uint8Array): Promise<string[][]> {
  if (bytes.byteLength > MAX_IMPORT_BYTES) throw invalid('That file is too big. Split it into files under 2 MB.');
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip || /\.xlsx$/i.test(name)) {
    if (!isZip) throw invalid('That file is not a valid Excel spreadsheet.');
    try {
      assertSafeZip(bytes);
    } catch (err) {
      throw invalid(err instanceof Error ? err.message : 'That spreadsheet could not be opened.');
    }
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
    } catch {
      throw invalid('That spreadsheet could not be opened. Save it again as .xlsx or CSV and try again.');
    }
    const ws = wb.worksheets[0];
    if (!ws) throw invalid('That spreadsheet has no sheets.');
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (rows.length > MAX_ROWS) return;
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push(Array.from(values, cellToString));
    });
    return rows.filter((r) => r.some((c) => c !== ''));
  }
  if (/\.xls$/i.test(name)) throw invalid('Old .xls files are not supported. Save it as .xlsx or CSV.');
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (text.includes('\u0000')) throw invalid('That file does not look like a CSV or Excel file.');
  try {
    return parseDelimited(text, MAX_ROWS + 1);
  } catch (err) {
    throw invalid(err instanceof Error ? err.message : 'That file could not be read.');
  }
}

export type ImportRow = {
  line: number;
  company: string;
  stand: string;
  typeName: string;
  hall: string;
  sizeSqm: number | null;
  openSides: number;
  contactName: string;
  contactEmail: string;
  phone: string;
  website: string;
  vatNumber: string;
  aspExhibitorId: string;
  action: 'create' | 'update' | 'error';
  companyAction: 'new' | 'existing';
  existingCompanyId: string | null;
  typeId: string | null;
  invite: boolean;
  messages: string[];
};

export type ImportPlan = {
  rows: ImportRow[];
  newHalls: string[];
  missingColumns: string[];
  recognisedColumns: string[];
  summary: { total: number; create: number; update: number; errors: number; newCompanies: number; invites: number };
};

function parseSize(v: string): number | null | 'bad' {
  if (!v) return null;
  const n = Number(v.replace(/,/g, '').replace(/\s*(m2|m²|sqm|sq m)\s*$/i, ''));
  if (!Number.isFinite(n) || n < 0 || n > 100_000) return 'bad';
  return Math.round(n * 100) / 100;
}

/** Works out exactly what an import would do, row by row, without changing anything. */
export async function planImport(actor: Actor, editionId: string, rowsIn: string[][], opts: { defaultTypeId: string | null }): Promise<ImportPlan> {
  await requireEditionPermission(actor, editionId, 'manage_exhibitors');
  if (rowsIn.length < 2) throw invalid('The file needs a heading row and at least one exhibitor.');
  if (rowsIn.length - 1 > MAX_ROWS) throw invalid(`Import up to ${MAX_ROWS} rows at a time.`);
  const [header, ...body] = rowsIn;
  const cols = mapHeader(header);
  const missingColumns = ['company', 'stand'].filter((f) => cols[f] === undefined);
  if (missingColumns.length) {
    return {
      rows: [],
      newHalls: [],
      missingColumns,
      recognisedColumns: Object.keys(cols),
      summary: { total: body.length, create: 0, update: 0, errors: body.length, newCompanies: 0, invites: 0 },
    };
  }

  const db = await getDb();
  const types = await db.select().from(exhibitorTypes).where(eq(exhibitorTypes.editionId, editionId));
  const hallRows = await db.select().from(halls).where(eq(halls.editionId, editionId));
  const standRows = await db.select().from(stands).where(eq(stands.editionId, editionId));
  const hallByName = new Map(hallRows.map((h) => [normName(h.name), h]));
  const standByNumber = new Map(standRows.map((s) => [s.number.toLowerCase(), s]));
  const defaultType = opts.defaultTypeId ? types.find((t) => t.id === opts.defaultTypeId) ?? null : null;

  const findType = (raw: string) => {
    if (!raw) return defaultType;
    const n = norm(raw);
    const exact = types.find((t) => norm(t.name) === n || norm(t.key) === n);
    if (exact) return exact;
    if (/\bspace\b|raw space/.test(n)) return types.find((t) => t.key === 'space_only') ?? null;
    if (/\bshell\b/.test(n)) return types.find((t) => t.key === 'shell_scheme') ?? null;
    return null;
  };

  // Existing companies are matched by event-website ID, then by exact name (never fuzzily).
  const get = (r: string[], f: keyof typeof FIELD_ALIASES) => (cols[f] === undefined ? '' : (r[cols[f]!] ?? '').trim());
  const names = [...new Set(body.map((r) => normName(get(r, 'company'))).filter(Boolean))];
  const aspIds = [...new Set(body.map((r) => get(r, 'aspExhibitorId')).filter(Boolean))];
  const nameMatches = names.length
    ? await db
        .select()
        .from(companies)
        .where(and(eq(companies.kind, 'exhibitor'), isNull(companies.archivedAt), inArray(sql`lower(regexp_replace(trim(${companies.name}), '\\s+', ' ', 'g'))`, names)))
        .orderBy(desc(companies.updatedAt))
    : [];
  const aspMatches = aspIds.length ? await db.select().from(companies).where(inArray(companies.aspExhibitorId, aspIds)) : [];
  const companiesHere = new Set(standRows.map((s) => s.companyId).filter(Boolean));
  const matchCompany = (name: string, aspId: string) => {
    if (aspId) {
      const byAsp = aspMatches.find((c) => c.aspExhibitorId === aspId);
      if (byAsp) return byAsp;
    }
    const candidates = nameMatches.filter((c) => normName(c.name) === normName(name));
    return candidates.find((c) => companiesHere.has(c.id)) ?? candidates[0] ?? null;
  };

  const memberCompanyIds = new Set(
    (nameMatches.length || aspMatches.length
      ? await db
          .select({ companyId: companyMembers.companyId })
          .from(companyMembers)
          .where(inArray(companyMembers.companyId, [...nameMatches, ...aspMatches].map((c) => c.id)))
      : []
    ).map((r) => r.companyId),
  );
  const pendingInvites = await db
    .select({ companyId: invitations.companyId, email: invitations.email })
    .from(invitations)
    .where(and(eq(invitations.editionId, editionId), eq(invitations.kind, 'exhibitor'), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date())));

  const seenStands = new Map<string, number>();
  const newCompanyNames = new Set<string>();
  const invitedCompanies = new Set<string>();
  const newHalls = new Set<string>();
  const rows: ImportRow[] = body.map((r, i) => {
    const line = i + 2;
    const messages: string[] = [];
    const company = get(r, 'company').replace(/\s+/g, ' ');
    const stand = get(r, 'stand');
    const typeRaw = get(r, 'type');
    const hall = get(r, 'hall');
    const size = parseSize(get(r, 'size'));
    const sidesRaw = get(r, 'openSides');
    const sides = sidesRaw ? Number.parseInt(sidesRaw, 10) : 1;
    const emailRaw = get(r, 'contactEmail');
    const contactEmail = emailRaw ? normaliseEmail(emailRaw.replace(/^mailto:/i, '')) : '';
    let error = false;

    if (!company) {
      messages.push('Company name is missing.');
      error = true;
    } else if (company.length > 200) {
      messages.push('Company name is too long.');
      error = true;
    }
    if (!stand) {
      messages.push('Stand number is missing.');
      error = true;
    } else if (stand.length > 30) {
      messages.push('Stand number is too long.');
      error = true;
    }
    const type = findType(typeRaw);
    if (!type) {
      messages.push(typeRaw ? `Unknown stand type “${typeRaw}”. Use one of: ${types.map((t) => t.name).join(', ')}.` : 'Stand type is missing and no default type was chosen.');
      error = true;
    }
    if (size === 'bad') {
      messages.push('Size must be a number of square metres.');
      error = true;
    }
    if (!Number.isInteger(sides) || sides < 0 || sides > 4) {
      messages.push('Open sides must be 0 to 4.');
      error = true;
    }
    if (contactEmail && !isValidEmail(contactEmail)) {
      messages.push(`“${emailRaw}” is not a valid email address.`);
      error = true;
    }
    if (hall && !hallByName.has(normName(hall))) newHalls.add(hall);

    const standKey = stand.toLowerCase();
    if (stand && seenStands.has(standKey)) {
      messages.push(`Stand ${stand} is also on line ${seenStands.get(standKey)}.`);
      error = true;
    } else if (stand) {
      seenStands.set(standKey, line);
    }

    const existing = company ? matchCompany(company, get(r, 'aspExhibitorId')) : null;
    let action: ImportRow['action'] = 'create';
    const existingStand = stand ? standByNumber.get(standKey) : undefined;
    if (existingStand) {
      if (existingStand.status === 'cancelled') {
        messages.push(`Stand ${stand} was cancelled. Restore it on the stands page instead.`);
        error = true;
      } else if (existingStand.companyId && existingStand.companyId !== existing?.id) {
        messages.push(`Stand ${stand} already belongs to another company.`);
        error = true;
      } else {
        action = 'update';
        messages.push(existingStand.companyId ? 'Stand already exists; its details will be updated.' : 'Stand exists with no company; it will be given to this company.');
      }
    }
    if (existing) messages.push('Matched to an existing company record.');
    else if (company) newCompanyNames.add(normName(company));

    const companyKey = existing?.id ?? `new:${normName(company)}`;
    let invite = false;
    if (!error && contactEmail) {
      const hasPeople = existing ? memberCompanyIds.has(existing.id) : false;
      const alreadyInvited = existing ? pendingInvites.some((p) => p.companyId === existing.id && p.email === contactEmail) : false;
      if (hasPeople) messages.push('The company already has people on BluePrint, so no invitation is needed.');
      else if (alreadyInvited) messages.push('This contact already has an invitation.');
      else if (invitedCompanies.has(companyKey)) messages.push('Another row already invites a contact for this company.');
      else {
        invite = true;
        invitedCompanies.add(companyKey);
      }
    } else if (!error && !contactEmail) {
      messages.push('No contact email, so nobody will be invited yet.');
    }

    return {
      line,
      company,
      stand,
      typeName: type?.name ?? typeRaw,
      hall,
      sizeSqm: size === 'bad' ? null : size,
      openSides: Number.isInteger(sides) ? sides : 1,
      contactName: get(r, 'contactName'),
      contactEmail,
      phone: get(r, 'phone'),
      website: get(r, 'website'),
      vatNumber: get(r, 'vatNumber'),
      aspExhibitorId: get(r, 'aspExhibitorId'),
      action: error ? 'error' : action,
      companyAction: existing ? 'existing' : 'new',
      existingCompanyId: existing?.id ?? null,
      typeId: type?.id ?? null,
      invite,
      messages,
    };
  });

  return {
    rows,
    newHalls: [...newHalls],
    missingColumns: [],
    recognisedColumns: Object.keys(cols),
    summary: {
      total: rows.length,
      create: rows.filter((r) => r.action === 'create').length,
      update: rows.filter((r) => r.action === 'update').length,
      errors: rows.filter((r) => r.action === 'error').length,
      newCompanies: new Set(rows.filter((r) => r.action !== 'error' && r.companyAction === 'new').map((r) => normName(r.company))).size,
      invites: rows.filter((r) => r.invite).length,
    },
  };
}

/** Applies the valid rows of an import. Rows with problems are skipped and reported. */
export async function runImport(actor: Actor, editionId: string, rowsIn: string[][], opts: { defaultTypeId: string | null; sendInvites: boolean }) {
  await requireEditionPermission(actor, editionId, 'manage_exhibitors', { write: true });
  const plan = await planImport(actor, editionId, rowsIn, { defaultTypeId: opts.defaultTypeId });
  if (plan.missingColumns.length) throw invalid(`The file needs these columns: ${plan.missingColumns.join(', ')}.`);
  const valid = plan.rows.filter((r) => r.action !== 'error');
  if (!valid.length) throw invalid('No rows could be imported. Fix the problems shown and try again.');

  const db = await getDb();
  const [edition] = await db.select().from(editions).where(eq(editions.id, editionId)).limit(1);
  if (!edition) throw notFound();
  if (opts.sendInvites && edition.status === 'draft') {
    throw conflict('This show is still a draft, so exhibitors cannot sign in yet. Import without sending invitations, or set the show live first.');
  }

  const invitesToMake: { email: string; companyId: string }[] = [];
  const result = await db.transaction(async (tx) => {
    const hallRows = await tx.select().from(halls).where(eq(halls.editionId, editionId));
    const hallByName = new Map(hallRows.map((h) => [normName(h.name), h.id]));
    let sort = hallRows.reduce((m, h) => Math.max(m, h.sort), 0);
    for (const name of plan.newHalls) {
      const [h] = await tx.insert(halls).values({ editionId, name: name.slice(0, 60), sort: ++sort }).returning();
      hallByName.set(normName(name), h.id);
    }
    const newCompanyIds = new Map<string, string>();
    let created = 0;
    let updated = 0;
    for (const r of valid) {
      let companyId = r.existingCompanyId ?? newCompanyIds.get(normName(r.company)) ?? null;
      if (!companyId) {
        const website = r.website ? (/^https?:\/\//i.test(r.website) ? r.website : `https://${r.website}`) : null;
        const [c] = await tx
          .insert(companies)
          .values({
            name: r.company,
            kind: 'exhibitor',
            website: website && website.length <= 300 ? website : null,
            phone: r.phone.slice(0, 40) || null,
            vatNumber: r.vatNumber.slice(0, 40) || null,
            aspExhibitorId: r.aspExhibitorId.slice(0, 100) || null,
          })
          .returning();
        companyId = c.id;
        newCompanyIds.set(normName(r.company), c.id);
      }
      const values = {
        exhibitorTypeId: r.typeId!,
        hallId: r.hall ? hallByName.get(normName(r.hall)) ?? null : null,
        sizeSqm: r.sizeSqm === null ? null : String(r.sizeSqm),
        openSides: r.openSides,
      };
      const [existing] = await tx
        .select()
        .from(stands)
        .where(and(eq(stands.editionId, editionId), sql`lower(${stands.number}) = lower(${r.stand})`))
        .limit(1);
      if (existing) {
        await tx.update(stands).set({ ...values, companyId }).where(eq(stands.id, existing.id));
        updated++;
      } else {
        await tx.insert(stands).values({ editionId, number: r.stand, companyId, ...values });
        created++;
      }
      if (r.invite && r.contactEmail) invitesToMake.push({ email: r.contactEmail, companyId });
    }
    return { created, updated, newCompanies: newCompanyIds.size, newHalls: plan.newHalls.length };
  });

  if (opts.sendInvites && invitesToMake.length) await assertRateLimit(`bulk-invite:${editionId}`, 5000, 24 * 3600, invitesToMake.length);
  for (const inv of invitesToMake) {
    await createInvitation(actor, { kind: 'exhibitor', email: inv.email, editionId, companyId: inv.companyId, role: 'main_contact' }, { send: opts.sendInvites, bulk: true });
  }
  await audit(actor, 'exhibitors.imported', {
    editionId,
    details: { ...result, invitations: invitesToMake.length, invitationsSent: opts.sendInvites, skipped: plan.summary.errors },
  });
  return { ...result, invitations: invitesToMake.length, invitationsSent: opts.sendInvites, skipped: plan.rows.filter((r) => r.action === 'error').map((r) => r.line) };
}

/** A starter file people can fill in. */
export function importTemplateCsv() {
  return [
    'Company,Stand,Type,Hall,Size (sqm),Open sides,Contact name,Contact email,Phone,Website,VAT number',
    'Example Insulation Ltd,N1-110,Shell scheme,N1,9,2,Alex Smith,alex@example.co.uk,020 7946 0000,example.co.uk,GB123456789',
    'Example Timber Frames,N3-501,Space only,N3,72,3,Sam Jones,sam@example.com,,,',
  ].join('\r\n');
}
