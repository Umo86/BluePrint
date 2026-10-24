import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb, useInMemoryDatabaseForTests } from '@/server/db/client';
import { editions, emailOutbox, files, invitations, standContractors, submissions } from '@/server/db/schema';
import { acceptInvitation, sendInvitationCode } from '@/server/auth/invitations';
import { createTask } from '@/server/services/tasks';
import { beginUpload, completeUpload, receiveLocalUpload, canReadFile } from '@/server/services/files';
import {
  contractorStands,
  nominateContractor,
  packForReview,
  packView,
  reviewPack,
  savePackDraft,
  spaceOnlyQueue,
  submitPack,
} from '@/server/services/space-only';
import { MemoryStorage, setStorageForTests } from '@/server/storage';
import { checkPack } from '@/lib/space-only';
import { randomToken, sha256Hex } from '@/server/security/crypto';
import { actorFor, codeFromEmail, lastEmailTo, makeEdition, makeExhibitor, makeStaff, makeUser } from '../support/factories';

const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const RULES = { maxHeightM: 4, maxPlatformMm: 599, stepsMakeComplex: true, minInsuranceGbp: 5_000_000, requiredDocs: ['drawings', 'risk_assessment'], complexDocs: ['structural_calculations'] };

beforeAll(async () => {
  await useInMemoryDatabaseForTests();
});
afterAll(closeDb);
afterEach(() => setStorageForTests(null));

async function upload(actor: ReturnType<typeof actorFor>, standId: string, name = 'doc.pdf') {
  const up = await beginUpload(actor, { purpose: 'space_only', filename: name, contentType: 'application/pdf', size: PDF.length, standId });
  await receiveLocalUpload(actor, up.fileId, PDF);
  return (await completeUpload(actor, up.fileId)).id;
}

describe('pack rules', () => {
  it('works out complex stands and what is missing', () => {
    const empty = checkPack(RULES, { heightM: null, platformMm: null, hasSteps: false, insuranceCoverGbp: null, insuranceExpiresOn: null }, {});
    expect(empty.complete).toBe(false);
    expect(empty.missing).toHaveLength(6);
    const tall = checkPack(RULES, { heightM: 5, platformMm: 0, hasSteps: false, insuranceCoverGbp: 10_000_000, insuranceExpiresOn: '2030-01-01' }, { drawings: ['a'], risk_assessment: ['b'] });
    expect(tall.isComplex).toBe(true);
    expect(tall.missing).toEqual(['Structural calculations']);
    const lowCover = checkPack(RULES, { heightM: 3, platformMm: 0, hasSteps: false, insuranceCoverGbp: 1_000_000, insuranceExpiresOn: '2020-01-01' }, { drawings: ['a'], risk_assessment: ['b'] }, { breakdownEndsAt: '2027-05-08T18:00:00Z' });
    expect(lowCover.missing.join(' ')).toMatch(/at least £5,000,000.*until the end of breakdown/);
  });
});

describe('space-only approvals', () => {
  it('runs nomination, pack, review, changes, approval and certificate', async () => {
    setStorageForTests(new MemoryStorage());
    const { edition, space } = await makeEdition();
    const db = await getDb();
    await db.update(editions).set({ spaceOnlyRules: RULES, breakdownEndsAt: new Date('2027-05-08T18:00:00Z') }).where(eq(editions.id, edition.id));
    const ops = await makeStaff(edition.id, 'show_team', ['review_space_only']);
    const hs = await makeStaff(edition.id, 'hs_reviewer');
    const viewer = await makeStaff(edition.id, 'show_team', ['manage_exhibitors']);
    const t = await createTask(actorFor(ops, { isSuperAdmin: true }), edition.id, {
      title: 'Space-only pack',
      kind: 'space_only_pack',
      deadline: { mode: 'offset', offsetDays: 28 },
      published: true,
      requirements: { [space.id]: 'required' },
    });
    const ex = await makeExhibitor(edition.id, space.id);
    const me = actorFor(ex.user);

    // The contractor is invited and joins.
    await expect(submitPack(me, ex.stand.id)).rejects.toThrow(/Nominate your stand contractor/);
    await nominateContractor(me, ex.stand.id, { companyName: 'Build Co', contactName: 'Bob', email: 'bob@buildco.example' });
    const [inv] = await db.select().from(invitations).where(and(eq(invitations.standId, ex.stand.id), eq(invitations.kind, 'contractor')));
    const token = randomToken(32);
    await db.update(invitations).set({ tokenHash: sha256Hex(token) }).where(eq(invitations.id, inv.id));
    await sendInvitationCode(token, {});
    await acceptInvitation(token, { name: 'Bob Builder', code: codeFromEmail((await lastEmailTo('bob@buildco.example')).subject) }, {});
    const [c] = await db.select().from(standContractors).where(eq(standContractors.standId, ex.stand.id));
    expect(c.status).toBe('active');
    const bob = actorFor({ ...ex.user, id: c.userId!, email: 'bob@buildco.example', isSuperAdmin: false });
    expect((await contractorStands(bob)).map((r) => r.stand.id)).toEqual([ex.stand.id]);

    // The contractor prepares the pack; it cannot be sent until complete.
    const drawings = await upload(bob, ex.stand.id, 'drawings.pdf');
    const risk = await upload(bob, ex.stand.id, 'risk.pdf');
    let check = await savePackDraft(bob, ex.stand.id, { heightM: 5, platformMm: 100, hasSteps: false, insuranceCoverGbp: 10_000_000, insuranceExpiresOn: '2027-12-31', documents: { drawings: [drawings], risk_assessment: [risk] } });
    expect(check.isComplex).toBe(true);
    await expect(submitPack(bob, ex.stand.id)).rejects.toThrow(/Structural calculations/);
    const calcs = await upload(bob, ex.stand.id, 'calcs.pdf');
    check = await savePackDraft(bob, ex.stand.id, { heightM: 5, platformMm: 100, hasSteps: false, insuranceCoverGbp: 10_000_000, insuranceExpiresOn: '2027-12-31', documents: { drawings: [drawings], risk_assessment: [risk], structural_calculations: [calcs] } });
    expect(check.complete).toBe(true);
    const { version } = await submitPack(bob, ex.stand.id);
    expect(version).toBe(1);
    const reviewerMail = await db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, hs.email));
    expect(reviewerMail.map((m) => m.subject)).toContain(`Space-only pack to review: stand ${ex.stand.number}`);
    // Once sent, it cannot be quietly changed.
    await expect(savePackDraft(me, ex.stand.id, { heightM: 3, platformMm: 0, hasSteps: false, insuranceCoverGbp: 10_000_000, insuranceExpiresOn: '2027-12-31', documents: {} })).rejects.toThrow(/with the show team/);
    const [sub] = await db.select().from(submissions).where(and(eq(submissions.taskId, t.id), eq(submissions.standId, ex.stand.id)));
    expect(sub.status).toBe('submitted');

    // Reviewers: the H&S reviewer asks for changes; a team member without review rights cannot decide.
    const queue = await spaceOnlyQueue(actorFor(hs), edition.id);
    expect(queue.counts.toReview).toBe(1);
    await expect(reviewPack(actorFor(viewer), ex.stand.id, { decision: 'approved' })).rejects.toThrow(/not decide/);
    await expect(reviewPack(actorFor(hs), ex.stand.id, { decision: 'changes_needed' })).rejects.toThrow(/Explain/);
    await reviewPack(actorFor(hs), ex.stand.id, { decision: 'changes_needed', comment: 'Calculations must be signed by the engineer.', docType: 'structural_calculations' });
    const view = await packView(me, ex.stand.id);
    expect(view.status).toBe('changes_needed');
    expect(view.editable).toBe(true);
    expect(view.reviews[0]).toMatchObject({ by: 'Health and safety', comment: 'Calculations must be signed by the engineer.' });
    const exMail = await db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, ex.user.email));
    expect(exMail.map((m) => m.subject)).toContain(`Changes needed: your space-only stand ${ex.stand.number}`);

    // New version, then approval with conditions issues a certificate both sides can download.
    await submitPack(me, ex.stand.id);
    await expect(reviewPack(actorFor(ops), ex.stand.id, { decision: 'approved_with_conditions' })).rejects.toThrow(/conditions/);
    await reviewPack(actorFor(ops), ex.stand.id, { decision: 'approved_with_conditions', conditions: 'No rigging without a rigging plan.' });
    const review = await packForReview(actorFor(ops), ex.stand.id);
    expect(review.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(review.pack?.status).toBe('approved_with_conditions');
    const [cert] = await db.select().from(files).where(eq(files.id, review.pack!.certificateFileId!));
    expect(cert.purpose).toBe('certificate');
    expect(cert.sizeBytes).toBeGreaterThan(1000);
    expect(await canReadFile(me, cert)).toBe(true);
    expect(await canReadFile(bob, cert)).toBe(true);
    const stranger = await makeUser();
    expect(await canReadFile(actorFor(stranger), cert)).toBe(false);
    const [approvedSub] = await db.select().from(submissions).where(and(eq(submissions.taskId, t.id), eq(submissions.standId, ex.stand.id)));
    expect(approvedSub.status).toBe('approved');
  });

  it('keeps space-only packs private to the stand, its contractor and the show team', async () => {
    const { edition, space, shell } = await makeEdition();
    const ex = await makeExhibitor(edition.id, space.id);
    const other = await makeExhibitor(edition.id, space.id);
    const shellEx = await makeExhibitor(edition.id, shell.id);
    await expect(packView(actorFor(other.user), ex.stand.id)).rejects.toThrow();
    await expect(packView(actorFor(shellEx.user), shellEx.stand.id)).rejects.toThrow();
    const otherShow = await makeEdition();
    const outsider = await makeStaff(otherShow.edition.id, 'hs_reviewer');
    await expect(spaceOnlyQueue(actorFor(outsider), edition.id)).rejects.toThrow();
    await expect(packForReview(actorFor(outsider), ex.stand.id)).rejects.toThrow();
    // Viewing as the exhibitor is read-only.
    const admin = await makeUser({ isSuperAdmin: true });
    await expect(nominateContractor(actorFor(ex.user, { readOnly: true, realUserId: admin.id, viewAsEditionId: ex.stand.editionId }), ex.stand.id, { selfBuild: true })).rejects.toThrow(/viewing as/);
    // Building it yourself makes you the contractor straight away.
    await nominateContractor(actorFor(ex.user), ex.stand.id, { selfBuild: true });
    const view = await packView(actorFor(ex.user), ex.stand.id);
    expect(view.contractor?.status).toBe('active');
  });
});
