import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { closeDb, getDb, useInMemoryDatabaseForTests } from '@/server/db/client';
import { companies, companyMembers, editions, emailEvents, emailOutbox, emailSuppressions, loginCodes, reminderLog, sessions, submissions, unsubscribes, users } from '@/server/db/schema';
import { createInvitation } from '@/server/auth/invitations';
import { createTask } from '@/server/services/tasks';
import { listTemplates, resetTemplate, saveTemplate, templateForEdit, emailLog } from '@/server/services/email-admin';
import { renderTemplate } from '@/server/email/templates';
import { sendEmail } from '@/server/email/send';
import { setEmailProviderForTests } from '@/server/email/provider';
import { runReminders, runStaffDigest } from '@/server/services/reminders';
import {
  audienceSize,
  createCampaign,
  processScheduledCampaigns,
  recipientsFor,
  sendCampaign,
  unsubscribeUrl,
  unsubscribeWithToken,
  describeUnsubscribe,
} from '@/server/services/campaigns';
import { handleResendEvent } from '@/server/services/email-events';
import { sendQueuedEmails } from '@/server/services/housekeeping';
import { runCronJob } from '@/server/cron';
import { GET as cronRoute } from '@/app/api/cron/[job]/route';
import { actorFor, makeEdition, makeExhibitor, makeStaff, makeUser } from '../support/factories';

const DAY = 86_400_000;

beforeAll(async () => {
  await useInMemoryDatabaseForTests();
});
afterAll(closeDb);

async function mailTo(email: string) {
  const db = await getDb();
  return db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, email.toLowerCase()));
}

describe('editable emails', () => {
  it('lets the team reword an email, but never lose the parts it needs', async () => {
    const { edition, shell } = await makeEdition();
    const admin = actorFor(await makeStaff(edition.id, 'show_admin'));
    const noEmails = actorFor(await makeStaff(edition.id, 'show_team', ['manage_exhibitors']));
    await expect(listTemplates(noEmails, edition.id)).rejects.toThrow();
    const list = await listTemplates(admin, edition.id);
    expect(list.map((t) => t.key)).toEqual(['invite_exhibitor', 'reminder_digest', 'order_confirmation']);
    expect(list.every((t) => !t.custom)).toBe(true);

    await expect(
      saveTemplate(admin, edition.id, 'invite_exhibitor', { subject: 'Hi', preheader: '', blocks: [{ type: 'paragraph', text: 'No link here' }] }),
    ).rejects.toThrow(/\{\{invite_link\}\}/);
    await expect(saveTemplate(admin, edition.id, 'order_confirmation', { subject: 'x', blocks: [{ type: 'tasks_due' }, { type: 'button', label: 'Go', url: '{{order_link}}' }] })).rejects.toThrow(/reminder emails/);
    await expect(saveTemplate(admin, edition.id, 'not_a_template', { subject: 'x', blocks: [] })).rejects.toThrow();
    await saveTemplate(admin, edition.id, 'invite_exhibitor', {
      subject: 'Welcome to {{show}}, {{company}}',
      preheader: 'Your portal',
      blocks: [
        { type: 'paragraph', text: 'Stand {{stand}}' },
        { type: 'button', label: 'Start', url: '{{invite_link}}' },
      ],
    });
    const t = await templateForEdit(admin, edition.id, 'invite_exhibitor');
    expect(t.custom).toBe(true);

    // The invitation an exhibitor receives now uses that wording.
    const ex = await makeExhibitor(edition.id, shell.id);
    await createInvitation(admin, { kind: 'exhibitor', email: 'new.person@acme.example', editionId: edition.id, companyId: ex.company.id, role: 'colleague' });
    const [mail] = await mailTo('new.person@acme.example');
    expect(mail.subject).toBe(`Welcome to ${edition.name}, ${ex.company.name}`);
    expect(mail.html).toMatch(/href="http:\/\/localhost:3000\/invite\/[A-Za-z0-9_-]+"/);
    expect(mail.text).toContain(`Stand ${ex.stand.number}`);

    await resetTemplate(admin, edition.id, 'invite_exhibitor');
    const r = await renderTemplate((await (await getDb()).select().from(editions).where(eq(editions.id, edition.id)))[0], 'invite_exhibitor', { invite_link: 'https://x.example/invite/1', company: 'Acme', stand: 'A1' });
    expect(r.subject).toBe(`Your exhibitor portal for ${edition.name}`);
  });

  it('sends show emails from the show’s own address once set', async () => {
    const { edition } = await makeEdition();
    const db = await getDb();
    await db.update(editions).set({ emailSettings: { senderName: 'UKCW Team', senderAddress: 'manual@mail.ukcw.example', replyTo: 'ops@ukcw.example' } }).where(eq(editions.id, edition.id));
    await sendEmail({ to: 'someone@example.com', editionId: edition.id, templateKey: 'x', category: 'transactional', subject: 'S', html: '<p>h</p>', text: 'h' });
    const [m] = (await mailTo('someone@example.com')).filter((x) => x.editionId === edition.id);
    expect(m.fromAddress).toBe('UKCW Team <manual@mail.ukcw.example>');
    expect(m.replyTo).toBe('ops@ukcw.example');
  });
});

describe('reminders', () => {
  it('reminds each stand once per step, lists what is due, and skips what is done', async () => {
    const { edition, shell, space } = await makeEdition();
    const db = await getDb();
    const buildUp = new Date(Date.now() + 40 * DAY);
    await db.update(editions).set({ buildUpStartsAt: buildUp }).where(eq(editions.id, edition.id));
    const admin = actorFor(await makeStaff(edition.id, 'show_admin'));
    // Due in 5 days (inside the 7-day step), and one due in 30 days (no step yet).
    const soon = await createTask(admin, edition.id, { title: 'Stand team details', kind: 'info', deadline: { mode: 'offset', offsetDays: 35 }, published: true, requirements: { [shell.id]: 'required', [space.id]: 'required' } });
    await createTask(admin, edition.id, { title: 'Hotel booking', kind: 'info', deadline: { mode: 'offset', offsetDays: 10 }, published: true, requirements: { [shell.id]: 'required' } });
    const a = await makeExhibitor(edition.id, shell.id);
    const b = await makeExhibitor(edition.id, shell.id);
    const c = await makeExhibitor(edition.id, space.id);
    // b has already done it.
    await db.insert(submissions).values({ taskId: soon.id, standId: b.stand.id, status: 'completed' });

    const first = await runReminders();
    expect(first.emails).toBeGreaterThanOrEqual(2);
    const aMail = (await mailTo(a.user.email)).filter((m) => m.templateKey === 'reminder_digest');
    expect(aMail).toHaveLength(1);
    expect(aMail[0].subject).toBe(`${edition.name}: 2 things to do for stand ${a.stand.number}`);
    expect(aMail[0].text).toContain('Stand team details');
    expect(aMail[0].text).toContain('Hotel booking');
    expect(aMail[0].category).toBe('reminder');
    expect((await mailTo(b.user.email)).filter((m) => m.templateKey === 'reminder_digest')).toHaveLength(0);
    expect((await mailTo(c.user.email)).filter((m) => m.templateKey === 'reminder_digest')).toHaveLength(1);

    // Running again the same day sends nothing new.
    await runReminders();
    expect((await mailTo(a.user.email)).filter((m) => m.templateKey === 'reminder_digest')).toHaveLength(1);

    // Four days later the 1-day step is reached: one more reminder.
    await runReminders(new Date(Date.now() + 4.5 * DAY));
    expect((await mailTo(a.user.email)).filter((m) => m.templateKey === 'reminder_digest')).toHaveLength(2);
    const steps = await db.select().from(reminderLog).where(eq(reminderLog.standId, a.stand.id));
    expect(steps.map((s) => s.step).sort()).toEqual(['d1', 'd7']);
  });

  it('sends the team one morning summary a day, only when there is something to say', async () => {
    const { edition } = await makeEdition();
    const admin = await makeStaff(edition.id, 'show_admin');
    const quiet = await runStaffDigest();
    expect((await mailTo(admin.email)).filter((m) => m.templateKey === 'staff_digest')).toHaveLength(0);
    expect(quiet.sent).toBeGreaterThanOrEqual(0);
  });
});

describe('updates to exhibitors', () => {
  async function campaignFixture() {
    const { edition, shell, space } = await makeEdition();
    const staff = actorFor(await makeStaff(edition.id, 'show_team', ['send_emails']));
    const a = await makeExhibitor(edition.id, shell.id);
    const b = await makeExhibitor(edition.id, shell.id);
    const c = await makeExhibitor(edition.id, space.id);
    const colleague = await makeUser();
    const db = await getDb();
    await db.insert(companyMembers).values({ companyId: a.company.id, userId: colleague.id, role: 'colleague' });
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, b.user.id));
    return { edition, shell, space, staff, a, b, c, colleague };
  }

  it('chooses the right people', async () => {
    const { edition, shell, space, a, b, c, colleague } = await campaignFixture();
    const emails = async (f: Parameters<typeof recipientsFor>[1]) => (await recipientsFor(edition.id, f)).map((r) => r.email).sort();
    expect(await emails({})).toEqual([a.user.email, b.user.email, c.user.email].sort());
    expect(await emails({ audience: 'everyone' })).toEqual([a.user.email, colleague.email, b.user.email, c.user.email].sort());
    expect(await emails({ exhibitorTypeIds: [space.id] })).toEqual([c.user.email]);
    expect(await emails({ exhibitorTypeIds: [shell.id], neverSignedIn: true })).toEqual([a.user.email]);
  });

  it('queues, sends in batches, honours unsubscribes and never sends twice', async () => {
    const { edition, staff, a, b, c } = await campaignFixture();
    const db = await getDb();
    await db.insert(unsubscribes).values({ email: c.user.email, editionId: edition.id });
    expect(await audienceSize(staff, edition.id, campaignFilter())).toMatchObject({ recipients: 2, unsubscribed: 1 });
    const viewer = actorFor(await makeStaff(edition.id, 'show_team', ['manage_exhibitors']));
    await expect(createCampaign(viewer, edition.id, campaignInput())).rejects.toThrow();
    const draft = await createCampaign(staff, edition.id, campaignInput());
    const sent = await sendCampaign(staff, draft.id);
    expect(sent.recipients).toBe(3);
    await expect(sendCampaign(staff, draft.id)).rejects.toThrow(/already/);
    const rows = await db.select().from(emailOutbox).where(eq(emailOutbox.campaignId, draft.id));
    expect(rows).toHaveLength(3);
    const byTo = Object.fromEntries(rows.map((r) => [r.toEmail, r]));
    expect(byTo[c.user.email].status).toBe('suppressed');
    expect(byTo[a.user.email].status).toBe('sent');
    expect(byTo[a.user.email].subject).toBe(`Build-up update for ${a.company.name}`);
    expect(byTo[a.user.email].html).toContain(`stand ${a.stand.number}`);
    expect(byTo[b.user.email].html).toContain(`stand ${b.stand.number}`);
    expect(byTo[a.user.email].headers?.['List-Unsubscribe']).toMatch(/^<http:\/\/localhost:3000\/api\/unsubscribe\/.+>$/);
    expect(byTo[a.user.email].headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(byTo[a.user.email].fromAddress).toBeTruthy();

    // The unsubscribe link works without signing in, and only for that person and show.
    const url = unsubscribeUrl(a.user.email, edition.id);
    const token = url.split('/unsubscribe/')[1];
    expect(await describeUnsubscribe(token)).toEqual({ email: a.user.email, show: edition.name });
    expect(await describeUnsubscribe(`${token}x`)).toBeNull();
    await unsubscribeWithToken(token);
    expect(await audienceSize(staff, edition.id, campaignFilter())).toMatchObject({ recipients: 1, unsubscribed: 2 });
    // Service emails still reach them.
    const r = await sendEmail({ to: a.user.email, editionId: edition.id, templateKey: 'order_confirmation', category: 'transactional', subject: 'Order', html: 'x', text: 'x' });
    expect(r.status).toBe('sent');
  });

  it('sends scheduled emails when their time comes', async () => {
    const { edition, staff } = await campaignFixture();
    const draft = await createCampaign(staff, edition.id, campaignInput());
    const later = new Date(Date.now() + 2 * 3600 * 1000);
    expect(await sendCampaign(staff, draft.id, { at: later })).toMatchObject({ scheduled: true });
    expect((await processScheduledCampaigns()).queued).toBe(0);
    const r = await processScheduledCampaigns(new Date(later.getTime() + 1000));
    expect(r.queued).toBe(3);
    const db = await getDb();
    const queued = await db.select().from(emailOutbox).where(and(eq(emailOutbox.campaignId, draft.id), eq(emailOutbox.status, 'queued')));
    expect(queued.length).toBe(3);
    const sent = await sendQueuedEmails();
    expect(sent.sent).toBeGreaterThanOrEqual(3);
    expect(await db.select().from(emailOutbox).where(and(eq(emailOutbox.campaignId, draft.id), eq(emailOutbox.status, 'queued')))).toHaveLength(0);
  });

  function campaignFilter() {
    return { exhibitorTypeIds: [], hallIds: [], neverSignedIn: false, standIds: [], audience: 'main_contacts' as const };
  }
  function campaignInput() {
    return {
      name: 'Build-up change',
      subject: 'Build-up update for {{company}}',
      blocks: [
        { type: 'paragraph' as const, text: 'Hello {{first_name}}, news for stand {{stand}}.' },
        { type: 'button' as const, label: 'Open your portal', url: '{{portal_link}}' },
      ],
      filter: campaignFilter(),
    };
  }
});

describe('delivery events from Resend', () => {
  it('tracks delivery, ignores repeats, and stops sending to bounced addresses', async () => {
    const db = await getDb();
    const res = await sendEmail({ to: 'bouncy@example.com', templateKey: 'x', category: 'transactional', subject: 'S', html: 'h', text: 'h' });
    const [mail] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, res.outboxId));
    const id = mail.providerMessageId!;
    await handleResendEvent('evt_a', { type: 'email.delivered', data: { email_id: id } });
    await handleResendEvent('evt_b', { type: 'email.opened', data: { email_id: id } });
    // A late "delivered" never moves it back from opened.
    await handleResendEvent('evt_c', { type: 'email.delivered', data: { email_id: id } });
    expect((await db.select().from(emailOutbox).where(eq(emailOutbox.id, mail.id)))[0].status).toBe('opened');
    expect(await handleResendEvent('evt_a', { type: 'email.delivered', data: { email_id: id } })).toEqual({ duplicate: true });
    expect(await handleResendEvent('evt_x', { type: 'email.delivered', data: { email_id: 'unknown' } })).toEqual({ ignored: true });
    await handleResendEvent('evt_d', { type: 'email.bounced', data: { email_id: id, bounce: { type: 'Permanent' } } });
    const [sup] = await db.select().from(emailSuppressions).where(eq(emailSuppressions.email, 'bouncy@example.com'));
    expect(sup.reason).toBe('bounced');
    expect(await db.select().from(emailEvents).where(eq(emailEvents.outboxId, mail.id))).toHaveLength(4);
    const next = await sendEmail({ to: 'bouncy@example.com', templateKey: 'x', category: 'reminder', subject: 'S', html: 'h', text: 'h' });
    expect(next.status).toBe('suppressed');
    const code = await sendEmail({ to: 'bouncy@example.com', templateKey: 'sign_in_code', category: 'security', subject: 'Code', html: 'h', text: 'h' });
    expect(code.status).toBe('sent');
  });
});

describe('scheduled jobs', () => {
  it('only runs for callers with the cron secret', async () => {
    const call = (job: string, auth?: string) =>
      cronRoute(new Request(`http://localhost/api/cron/${job}`, { headers: auth ? { authorization: auth } : {} }), { params: Promise.resolve({ job }) } as never);
    expect((await call('housekeeping')).status).toBe(404);
    expect((await call('housekeeping', 'Bearer wrong')).status).toBe(404);
    expect((await call('nope', 'Bearer test-cron-secret')).status).toBe(404);
    const ok = await call('housekeeping', 'Bearer test-cron-secret');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, job: 'housekeeping' });
  });

  it('tidies up expired records and old email logs', async () => {
    const db = await getDb();
    const u = await makeUser();
    await db.insert(sessions).values({ id: `old-${u.id}`, userId: u.id, expiresAt: new Date(Date.now() - 3 * DAY), idleTimeoutSeconds: 60 });
    await db.insert(loginCodes).values({ email: u.email, codeHash: 'x', expiresAt: new Date(Date.now() - 2 * DAY), createdAt: new Date(Date.now() - 2 * DAY) });
    const [old] = await db
      .insert(emailOutbox)
      .values({ toEmail: 'old@example.com', templateKey: 'x', category: 'transactional', fromAddress: 'a@b.c', subject: 's', html: 'h', text: 't', status: 'sent', createdAt: new Date(Date.now() - 900 * DAY) })
      .returning();
    const r = await runCronJob('housekeeping');
    expect(r).toMatchObject({ sessionsRemoved: expect.any(Number) });
    expect(await db.select().from(sessions).where(eq(sessions.id, `old-${u.id}`))).toHaveLength(0);
    expect(await db.select().from(emailOutbox).where(eq(emailOutbox.id, old.id))).toHaveLength(0);
    expect(await db.select().from(loginCodes).where(inArray(loginCodes.email, [u.email]))).toHaveLength(0);
  });

  it('keeps a log the team can search', async () => {
    const { edition } = await makeEdition();
    const admin = actorFor(await makeStaff(edition.id, 'show_admin'));
    await sendEmail({ to: 'logme@example.com', editionId: edition.id, templateKey: 'x', category: 'reminder', subject: 'Reminder for you', html: 'h', text: 't' });
    const log = await emailLog(admin, edition.id, { filter: 'reminder', q: 'logme' });
    expect(log.rows.map((r) => r.toEmail)).toEqual(['logme@example.com']);
    const db = await getDb();
    expect((await db.select().from(companies).limit(1)).length).toBeGreaterThan(0);
  });
});

describe('batch sending', () => {
  it('never sends the same queued email twice, even with two senders at once', async () => {
    const sent: string[] = [];
    setEmailProviderForTests({ name: 'counting', send: async (m) => { sent.push(m.to); return { id: `c_${sent.length}_${Math.random()}` }; } });
    try {
      for (let i = 0; i < 5; i++) {
        await sendEmail({ to: `batch${i}@example.com`, templateKey: 'x', category: 'campaign', subject: 'S', html: 'h', text: 't', deferred: true });
      }
      await Promise.all([sendQueuedEmails(), sendQueuedEmails()]);
      expect(sent.filter((t) => t.startsWith('batch')).sort()).toEqual(['batch0@example.com', 'batch1@example.com', 'batch2@example.com', 'batch3@example.com', 'batch4@example.com']);
    } finally {
      setEmailProviderForTests(null);
    }
  });
});
