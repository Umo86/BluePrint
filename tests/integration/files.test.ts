import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, useInMemoryDatabaseForTests } from '@/server/db/client';
import { files, standContractors } from '@/server/db/schema';
import { beginUpload, canReadFile, completeUpload, getFile, receiveLocalUpload, requireOwnVerifiedFile } from '@/server/services/files';
import { MemoryStorage, setStorageForTests, contentDisposition, assertSafeKey } from '@/server/storage';
import { actorFor, makeEdition, makeExhibitor, makeStaff, makeUser } from '../support/factories';

// The smallest valid PNG (1x1 pixel).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

let mem: MemoryStorage;
beforeAll(async () => {
  await useInMemoryDatabaseForTests();
});
afterAll(closeDb);
afterEach(() => setStorageForTests(null));

function freshStorage() {
  mem = new MemoryStorage();
  setStorageForTests(mem);
}

describe('uploads', () => {
  it('accepts a real image for branding and serves it publicly', async () => {
    freshStorage();
    const { edition } = await makeEdition();
    const content = await makeStaff(edition.id, 'show_team', ['edit_content']);
    const begin = await beginUpload(actorFor(content), { purpose: 'branding', filename: 'logo.png', contentType: 'image/png', size: PNG.length, editionId: edition.id });
    expect(begin.uploadUrl).toBe(`/api/files/upload/${begin.fileId}`);
    expect(await getFile(begin.fileId).then((f) => f?.verifiedAt)).toBeNull();
    await receiveLocalUpload(actorFor(content), begin.fileId, new Uint8Array(PNG));
    const done = await completeUpload(actorFor(content), begin.fileId);
    expect(done.verifiedAt).not.toBeNull();
    expect(done.mimeType).toBe('image/png');
    expect(done.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await canReadFile(null, done)).toBe(true);
    expect((await requireOwnVerifiedFile(actorFor(content), done.id, 'branding')).id).toBe(done.id);
  });

  it('rejects files whose content does not match, and deletes them', async () => {
    freshStorage();
    const { edition } = await makeEdition();
    const content = await makeStaff(edition.id, 'show_team', ['edit_content']);
    const begin = await beginUpload(actorFor(content), { purpose: 'branding', filename: 'logo.png', contentType: 'image/png', size: 40, editionId: edition.id });
    await receiveLocalUpload(actorFor(content), begin.fileId, new TextEncoder().encode('<svg onload="alert(1)"></svg>'));
    await expect(completeUpload(actorFor(content), begin.fileId)).rejects.toThrow(/isn’t what its name says/);
    expect(await getFile(begin.fileId)).toBeNull();
    expect(mem.objects.size).toBe(0);
    // SVG is refused before upload even starts.
    await expect(beginUpload(actorFor(content), { purpose: 'branding', filename: 'logo.svg', contentType: 'image/svg+xml', size: 40, editionId: edition.id })).rejects.toThrow(/isn’t accepted/);
    await expect(beginUpload(actorFor(content), { purpose: 'branding', filename: 'big.png', contentType: 'image/png', size: 50 * 1024 * 1024, editionId: edition.id })).rejects.toThrow(/too big/);
  });

  it('only lets people upload for places they can act on', async () => {
    freshStorage();
    const { edition, shell } = await makeEdition();
    const mine = await makeExhibitor(edition.id, shell.id);
    const theirs = await makeExhibitor(edition.id, shell.id);
    const viewer = await makeStaff(edition.id, 'show_team', []);
    await expect(beginUpload(actorFor(mine.user), { purpose: 'submission', filename: 'a.pdf', contentType: 'application/pdf', size: 10, standId: theirs.stand.id })).rejects.toThrow();
    await expect(beginUpload(actorFor(viewer), { purpose: 'branding', filename: 'a.png', contentType: 'image/png', size: 10, editionId: edition.id })).rejects.toThrow();
    await expect(beginUpload(actorFor(mine.user, { readOnly: true }), { purpose: 'submission', filename: 'a.pdf', contentType: 'application/pdf', size: 10, standId: mine.stand.id })).rejects.toThrow();
    const ok = await beginUpload(actorFor(mine.user), { purpose: 'submission', filename: 'risk.pdf', contentType: 'application/pdf', size: PDF.length, standId: mine.stand.id });
    // Someone else cannot push bytes into another person's upload.
    await expect(receiveLocalUpload(actorFor(theirs.user), ok.fileId, new Uint8Array(PDF))).rejects.toThrow();
    await receiveLocalUpload(actorFor(mine.user), ok.fileId, new Uint8Array(PDF));
    const file = await completeUpload(actorFor(mine.user), ok.fileId);
    expect(file.companyId).toBe(mine.company.id);
    expect(file.isPublic).toBe(false);

    // Who can read the submitted PDF?
    const otherShowStaff = await makeStaff((await makeEdition()).edition.id, 'show_admin');
    const reviewer = await makeStaff(edition.id, 'hs_reviewer');
    const exhibitorTeam = await makeStaff(edition.id, 'show_team', ['manage_exhibitors']);
    const helpDesk = await makeStaff(edition.id, 'show_team', ['helpdesk']);
    const emailsOnly = await makeStaff(edition.id, 'show_team', ['send_emails']);
    expect(await canReadFile(actorFor(mine.user), file)).toBe(true);
    // The show team opens exhibitors' documents only if their permissions cover that work.
    expect(await canReadFile(actorFor(exhibitorTeam), file)).toBe(true);
    expect(await canReadFile(actorFor(helpDesk), file)).toBe(true);
    expect(await canReadFile(actorFor(viewer), file)).toBe(false);
    expect(await canReadFile(actorFor(emailsOnly), file)).toBe(false);
    expect(await canReadFile(actorFor(theirs.user), file)).toBe(false);
    expect(await canReadFile(actorFor(otherShowStaff), file)).toBe(false);
    expect(await canReadFile(actorFor(reviewer), file)).toBe(false);
    expect(await canReadFile(null, file)).toBe(false);
  });

  it('lets the nominated contractor upload and read space-only files', async () => {
    freshStorage();
    const { edition, space } = await makeEdition();
    const ex = await makeExhibitor(edition.id, space.id);
    const builder = await makeUser();
    const db = await getDb();
    await db.insert(standContractors).values({ standId: ex.stand.id, contractorCompanyName: 'Build Co', contactName: 'B', contactEmail: builder.email, userId: builder.id, status: 'active' });
    const up = await beginUpload(actorFor(builder), { purpose: 'space_only', filename: 'stand.dwg', contentType: '', size: 20, standId: ex.stand.id });
    await receiveLocalUpload(actorFor(builder), up.fileId, new TextEncoder().encode('AC1032 drawing data....'));
    const f = await completeUpload(actorFor(builder), up.fileId);
    expect(f.mimeType).toBe('image/vnd.dwg');
    const reviewer = await makeStaff(edition.id, 'hs_reviewer');
    expect(await canReadFile(actorFor(reviewer), f)).toBe(true);
    expect(await canReadFile(actorFor(ex.user), f)).toBe(true);
    // A stranger cannot upload for that stand.
    const stranger = await makeUser();
    await expect(beginUpload(actorFor(stranger), { purpose: 'space_only', filename: 'x.pdf', contentType: 'application/pdf', size: 10, standId: ex.stand.id })).rejects.toThrow();
    const [row] = await db.select().from(files).where(eq(files.id, f.id));
    expect(row.storageKey).toMatch(/^space_only\/\d{4}-\d{2}\/[0-9a-f-]{36}$/);
  });

  it('keeps storage keys and download names safe', () => {
    expect(() => assertSafeKey('../etc/passwd')).toThrow();
    expect(() => assertSafeKey('branding/2026-10/abc')).not.toThrow();
    expect(contentDisposition('evil"\r\nSet-Cookie: x.pdf', false)).toBe(
      `attachment; filename="evil___Set-Cookie: x.pdf"; filename*=UTF-8''evil___Set-Cookie%3A%20x.pdf`,
    );
    expect(contentDisposition('Stand plan – N1.pdf', true)).toContain("inline; filename=\"Stand plan _ N1.pdf\"; filename*=UTF-8''Stand%20plan%20%E2%80%93%20N1.pdf");
  });
});
