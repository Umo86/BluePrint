import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb, useInMemoryDatabaseForTests } from '@/server/db/client';
import {
  assistantFaqs,
  assistantMessages,
  assistantUnanswered,
  auditLog,
  companyMembers,
  editions,
  emailOutbox,
  manualPages,
  reminderLog,
  submissions,
  taskRequirements,
  tasks,
  ticketMessages,
  tickets,
} from '@/server/db/schema';
import {
  assignTicket,
  closeTicketAsExhibitor,
  deleteSavedReply,
  helpdeskQueue,
  listSavedReplies,
  openTicket,
  replyAsExhibitor,
  replyAsStaff,
  saveSavedReply,
  ticketForExhibitor,
  ticketForStaff,
  ticketsForStand,
} from '@/server/services/helpdesk';
import {
  applyFormProposal,
  askAssistant,
  assistantInsights,
  pendingNudges,
  recordNudges,
  assistantView,
  conversationForStaff,
  resolveUnanswered,
  sendTicketProposal,
  startNewConversation,
} from '@/server/assistant';
import { setAssistantModelForTests, resetAssistantModelForTests, OfflineModel, type AssistantModel, type ModelReply, type ModelRequest } from '@/server/assistant/model';
import { htmlToParagraphs, searchChunks, splitText, type Chunk } from '@/server/assistant/knowledge';
import { updatePlatformSettings } from '@/server/services/settings';
import { consumeRateLimit } from '@/server/security/rate-limit';
import { beginUpload, canReadFile, completeUpload, getFile, receiveLocalUpload } from '@/server/services/files';
import { MemoryStorage, setStorageForTests } from '@/server/storage';
import { actorFor, makeEdition, makeExhibitor, makeStaff, makeUser } from '../support/factories';

const DAY = 86_400_000;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

beforeAll(async () => {
  await useInMemoryDatabaseForTests();
});
afterAll(closeDb);
afterEach(() => {
  resetAssistantModelForTests();
  setStorageForTests(null);
});

async function mailTo(email: string) {
  const db = await getDb();
  return db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, email.toLowerCase()));
}

/** A model that replies from a script and records what it was sent. */
class ScriptedModel implements AssistantModel {
  kind = 'claude' as const;
  requests: ModelRequest[] = [];
  constructor(private script: ((req: ModelRequest) => ModelReply)[]) {}
  async reply(req: ModelRequest): Promise<ModelReply> {
    this.requests.push(JSON.parse(JSON.stringify(req)) as ModelRequest);
    const next = this.script.shift();
    if (!next) throw new Error('No more scripted replies');
    return next(req);
  }
}
const tool = (name: string, input: Record<string, unknown>, id = `toolu_${name}`): ModelReply => ({
  content: [{ type: 'tool_use', id, name, input }],
  stopReason: 'tool_use',
  usage: { inputTokens: 100, outputTokens: 20 },
  model: 'claude-test',
});
const text = (t: string): ModelReply => ({ content: [{ type: 'text', text: t }], stopReason: 'end_turn', usage: { inputTokens: 120, outputTokens: 30 }, model: 'claude-test' });
const lastToolResult = (req: ModelRequest) => {
  const m = req.messages[req.messages.length - 1];
  return Array.isArray(m.content) ? (m.content[0] as { content: string; is_error?: boolean }) : null;
};

async function showWithManual() {
  const { edition, shell, space } = await makeEdition();
  const db = await getDb();
  await db.insert(manualPages).values([
    { editionId: edition.id, title: 'Deliveries and access', slug: 'deliveries', bodyHtml: '<p>All deliveries use the <strong>Eastern entrance</strong> between 07:00 and 19:00.</p><ul><li>Vans may stay 30 minutes.</li></ul><p><a href="/files/00000000-0000-4000-8000-000000000001">site-plan.pdf</a></p>' },
    { editionId: edition.id, title: 'Rigging rules', slug: 'rigging', bodyHtml: '<p>Rigging points must be booked with the venue. Maximum load 250 kg per point.</p>', visibleToTypes: [space.id] },
  ]);
  const [form] = await db
    .insert(tasks)
    .values({
      editionId: edition.id,
      title: 'Fascia name board',
      kind: 'form',
      deadlineAt: new Date(Date.now() + 5 * DAY),
      formSchema: [
        { id: 'fascia', type: 'text', label: 'Name on the fascia', required: true },
        { id: 'colour', type: 'select', label: 'Colour', options: ['Black', 'White'] },
        { id: 'logo', type: 'file', label: 'Logo' },
      ] as never,
    })
    .returning();
  await db.insert(taskRequirements).values({ taskId: form.id, exhibitorTypeId: shell.id, requirement: 'required' });
  const a = await makeExhibitor(edition.id, shell.id, 'A1');
  const b = await makeExhibitor(edition.id, shell.id, 'B2');
  const p = await makeExhibitor(edition.id, space.id, 'P3');
  return { edition, shell, space, form, a, b, p };
}

describe('help desk', () => {
  it('lets an exhibitor ask the team, and keeps it within their company', async () => {
    const s = await showWithManual();
    const desk = await makeStaff(s.edition.id, 'show_team', ['helpdesk']);
    const sales = await makeStaff(s.edition.id, 'show_team', ['manage_exhibitors']);
    const me = actorFor(s.a.user);
    const t = await openTicket(me, s.a.stand.id, { subject: 'Extra power', body: 'Can we have a second socket?' });
    expect(t.number).toMatch(/^HD-\d{6}$/);
    expect(t).toMatchObject({ status: 'open', source: 'portal', lastMessageBy: 'exhibitor', contactEmail: s.a.user.email });
    expect((await mailTo(desk.email)).map((m) => m.subject)).toEqual([`New question from ${s.a.company.name}: Extra power`]);
    expect(await mailTo(sales.email)).toHaveLength(0);

    // A colleague sees it; another exhibitor does not.
    const db = await getDb();
    const colleague = await makeUser({ name: 'Colleague' });
    await db.insert(companyMembers).values({ companyId: s.a.company.id, userId: colleague.id, role: 'colleague' });
    expect((await ticketsForStand(actorFor(colleague), s.a.stand.id)).map((x) => x.id)).toEqual([t.id]);
    await expect(ticketForExhibitor(actorFor(s.b.user), s.b.stand.id, t.id)).rejects.toThrow();
    await expect(ticketForExhibitor(actorFor(s.b.user), s.a.stand.id, t.id)).rejects.toThrow();
    expect(await ticketsForStand(actorFor(s.b.user), s.b.stand.id)).toEqual([]);

    // Only help desk staff see the queue.
    await expect(helpdeskQueue(actorFor(sales), s.edition.id)).rejects.toThrow();
    const q = await helpdeskQueue(actorFor(desk), s.edition.id);
    expect(q.rows.map((r) => r.ticket.id)).toEqual([t.id]);
    expect(q.counts).toEqual({ open: 1, pending: 0, closed: 0 });

    // The team replies (the exhibitor is emailed) and adds an internal note (never shown).
    await replyAsStaff(actorFor(desk), t.id, { body: 'Yes, order a second socket in the shop.' });
    await replyAsStaff(actorFor(desk), t.id, { body: 'Check with PowerOn about capacity.', internal: true });
    const mail = (await mailTo(s.a.user.email)).find((m) => m.subject.startsWith('Re: Extra power'));
    expect(mail?.text).toContain('order a second socket');
    const seen = await ticketForExhibitor(me, s.a.stand.id, t.id);
    expect(seen.messages.map((m) => [m.fromTeam, m.body])).toEqual([
      [false, 'Can we have a second socket?'],
      [true, 'Yes, order a second socket in the shop.'],
    ]);
    expect(seen.ticket.status).toBe('pending');
    const staffView = await ticketForStaff(actorFor(desk), t.id);
    expect(staffView.messages.map((m) => m.internal)).toEqual([false, false, true]);
    expect(staffView.ticket.assignedTo).toBe(desk.id);

    // The exhibitor replies: back with the team.
    await replyAsExhibitor(me, s.a.stand.id, t.id, { body: 'Thanks, done.' });
    expect((await ticketForStaff(actorFor(desk), t.id)).ticket.status).toBe('open');
    await closeTicketAsExhibitor(me, s.a.stand.id, t.id);
    expect((await helpdeskQueue(actorFor(desk), s.edition.id, { status: 'closed' })).rows).toHaveLength(1);

    // Assigning only to help desk staff.
    await expect(assignTicket(actorFor(desk), t.id, sales.id)).rejects.toThrow(/help desk/);
    const desk2 = await makeStaff(s.edition.id, 'show_team', ['helpdesk']);
    await assignTicket(actorFor(desk), t.id, desk2.id);
    expect((await mailTo(desk2.email)).some((m) => m.subject === 'Assigned to you: Extra power')).toBe(true);

    // Viewing as someone else cannot write; other shows' staff cannot reply.
    await expect(openTicket(actorFor(s.a.user, { readOnly: true }), s.a.stand.id, { subject: 'Hello', body: 'Hi' })).rejects.toThrow();
    const otherDesk = await makeStaff((await makeEdition('Other Expo 2027')).edition.id, 'show_team', ['helpdesk']);
    await expect(replyAsStaff(actorFor(otherDesk), t.id, { body: 'Hi' })).rejects.toThrow();
    const logged = await db.select().from(auditLog).where(and(eq(auditLog.entityId, t.id), eq(auditLog.action, 'ticket.opened')));
    expect(logged).toHaveLength(1);
  });

  it('checks attachments, limits new questions and keeps saved replies to the show', async () => {
    const s = await showWithManual();
    setStorageForTests(new MemoryStorage());
    const me = actorFor(s.a.user);
    const up = await beginUpload(me, { purpose: 'ticket', filename: 'quote.pdf', contentType: 'application/pdf', size: PDF.length, standId: s.a.stand.id });
    await receiveLocalUpload(me, up.fileId, new Uint8Array(PDF));
    await completeUpload(me, up.fileId);
    const t = await openTicket(me, s.a.stand.id, { subject: 'Quote attached', body: 'See attached.', attachments: [up.fileId] });
    const db = await getDb();
    const [msg] = await db.select().from(ticketMessages).where(eq(ticketMessages.ticketId, t.id));
    expect(msg.attachments).toEqual([up.fileId]);
    // Someone else's upload cannot be attached.
    await expect(openTicket(actorFor(s.b.user), s.b.stand.id, { subject: 'Not mine', body: 'x', attachments: [up.fileId] })).rejects.toThrow(/could not be found/);

    // A file on the team's internal note stays with the team, even if its address leaks.
    const deskUser = await makeStaff(s.edition.id, 'show_team', ['helpdesk']);
    const note = await beginUpload(actorFor(deskUser), { purpose: 'ticket', filename: 'supplier-email.pdf', contentType: 'application/pdf', size: PDF.length, standId: s.a.stand.id });
    await receiveLocalUpload(actorFor(deskUser), note.fileId, new Uint8Array(PDF));
    const noteFile = await completeUpload(actorFor(deskUser), note.fileId);
    expect(await canReadFile(me, noteFile)).toBe(true);
    await replyAsStaff(actorFor(deskUser), t.id, { body: 'Supplier confirmed by email.', internal: true, attachments: [note.fileId] });
    const after = (await getFile(note.fileId))!;
    expect(await canReadFile(me, after)).toBe(false);
    expect(await canReadFile(actorFor(deskUser), after)).toBe(true);

    await consumeRateLimit(`ticket-open:${s.b.user.id}`, 10, 3600, 10);
    await expect(openTicket(actorFor(s.b.user), s.b.stand.id, { subject: 'Eleventh', body: 'x' })).rejects.toThrow(/Too many/);

    const desk = actorFor(await makeStaff(s.edition.id, 'show_team', ['helpdesk']));
    await saveSavedReply(desk, s.edition.id, null, { title: 'Power', body: 'Order power in the shop.' });
    const replies = await listSavedReplies(desk, s.edition.id);
    expect(replies.map((r) => r.title)).toEqual(['Power']);
    const other = await makeEdition('Other Expo 2027');
    const otherDesk = actorFor(await makeStaff(other.edition.id, 'show_team', ['helpdesk']));
    await expect(deleteSavedReply(otherDesk, other.edition.id, replies[0].id)).rejects.toThrow();
    await expect(listSavedReplies(otherDesk, s.edition.id)).rejects.toThrow();
  });
});

describe('assistant knowledge', () => {
  it('turns pages into searchable text and finds the right passage', () => {
    const text = htmlToParagraphs('<h2>Access</h2><p>Use the <b>Eastern</b> entrance.</p><ul><li>Vans: 30 minutes</li></ul><p><a href="/files/abc">plan.pdf</a> &amp; more</p>');
    expect(text).toBe('Access\nUse the Eastern entrance.\n\n- Vans: 30 minutes\n\nplan.pdf (/files/abc) & more');
    expect(splitText('a'.repeat(3000), 1200)).toHaveLength(3);
    const chunks: Chunk[] = [
      { kind: 'page', title: 'Deliveries and access', link: '/d', text: 'All deliveries use the Eastern entrance.' },
      { kind: 'page', title: 'Catering', link: '/c', text: 'Food can be ordered from the venue.' },
      { kind: 'faq', title: 'Can I bring a forklift?', link: null, text: 'Q: Can I bring a forklift?\nA: No, use the venue forklift service.' },
    ];
    expect(searchChunks(chunks, 'Where do deliveries go?')[0].chunk.title).toBe('Deliveries and access');
    expect(searchChunks(chunks, 'forklift')[0].chunk.kind).toBe('faq');
    expect(searchChunks(chunks, 'parking for coaches')).toEqual([]);
  });
});

describe('assistant', () => {
  it('answers from the manual pages this stand type can read, and only for this exhibitor', async () => {
    const s = await showWithManual();
    const model = new ScriptedModel([() => tool('search_manual', { query: 'rigging deliveries' }), () => text('Use the Eastern entrance.')]);
    setAssistantModelForTests(model);
    const r = await askAssistant(actorFor(s.a.user), s.a.stand.id, { text: 'Where do deliveries go?' });
    expect(r.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(r.messages[1].content).toBe('Use the Eastern entrance.');
    const result = JSON.parse(lastToolResult(model.requests[1])!.content) as { results: { title: string; link: string; text: string }[] };
    // The rigging page is for space-only stands, so a shell scheme stand never sees it.
    expect(result.results.map((x) => x.title)).toEqual(['Deliveries and access']);
    expect(result.results[0].link).toBe(`/portal/${s.edition.slug}/manual/deliveries`);
    expect(result.results[0].text).toContain('site-plan.pdf (/files/00000000-0000-4000-8000-000000000001)');
    // The prompt is about this exhibitor only.
    expect(model.requests[0].system.dynamic).toContain(`Their stand: A1, Shell scheme`);
    expect(model.requests[0].system.dynamic).not.toContain('B2');
    expect(model.requests[0].messages).toEqual([{ role: 'user', content: 'Where do deliveries go?' }]);

    // The next question carries the conversation so far.
    const model2 = new ScriptedModel([() => text('You are welcome.')]);
    setAssistantModelForTests(model2);
    await askAssistant(actorFor(s.a.user), s.a.stand.id, { text: 'Thanks' });
    expect(model2.requests[0].messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    const view = await assistantView(actorFor(s.a.user), s.a.stand.id);
    expect(view.available && view.messages.length).toBe(4);
    // A colleague has their own conversation.
    expect((await assistantView(actorFor(s.b.user), s.b.stand.id)).available && (await assistantView(actorFor(s.b.user), s.b.stand.id))).toMatchObject({ messages: [] });
    await startNewConversation(actorFor(s.a.user), s.a.stand.id);
    const fresh = await assistantView(actorFor(s.a.user), s.a.stand.id);
    expect(fresh.available && fresh.messages).toEqual([]);
  });

  it('suggests form answers that the exhibitor puts in the form themselves', async () => {
    const s = await showWithManual();
    const model = new ScriptedModel([
      () => tool('propose_form_answers', { task_id: s.form.id, answers: { logo: ['x'] } }, 'toolu_1'),
      (req) => {
        expect(lastToolResult(req)).toMatchObject({ is_error: true });
        expect(lastToolResult(req)!.content).toContain('has to be completed by the exhibitor');
        return tool('propose_form_answers', { task_id: s.form.id, answers: { fascia: 'ACME INSULATION', colour: 'Black' } }, 'toolu_2');
      },
      () => text('I have filled that in for you to check.'),
    ]);
    setAssistantModelForTests(model);
    const r = await askAssistant(actorFor(s.a.user), s.a.stand.id, { text: 'Our fascia should say ACME INSULATION in black' });
    const msg = r.messages[1];
    expect(msg.meta.proposals).toEqual([
      { kind: 'form', taskId: s.form.id, taskTitle: 'Fascia name board', answers: { fascia: 'ACME INSULATION', colour: 'Black' }, display: [{ label: 'Name on the fascia', value: 'ACME INSULATION' }, { label: 'Colour', value: 'Black' }] },
    ]);
    const db = await getDb();
    // Nothing is saved until the exhibitor accepts.
    expect(await db.select().from(submissions).where(eq(submissions.taskId, s.form.id))).toEqual([]);
    await expect(applyFormProposal(actorFor(s.b.user), s.b.stand.id, msg.id, 0)).rejects.toThrow();
    await applyFormProposal(actorFor(s.a.user), s.a.stand.id, msg.id, 0);
    const [sub] = await db.select().from(submissions).where(eq(submissions.taskId, s.form.id));
    expect(sub).toMatchObject({ status: 'draft', data: { fascia: 'ACME INSULATION', colour: 'Black' } });
    await expect(applyFormProposal(actorFor(s.a.user), s.a.stand.id, msg.id, 0)).rejects.toThrow(/already/);

    // Tasks of other stand types or shows are out of reach.
    const model2 = new ScriptedModel([
      () => tool('task_details', { task_id: s.form.id }),
      (req) => {
        expect(lastToolResult(req)).toMatchObject({ is_error: true });
        return text('That is not on your checklist.');
      },
    ]);
    setAssistantModelForTests(model2);
    await askAssistant(actorFor(s.p.user), s.p.stand.id, { text: 'Show me the fascia form' });
    expect(model2.requests).toHaveLength(2);
  });

  it('hands over to the team and records questions it could not answer', async () => {
    const s = await showWithManual();
    const desk = await makeStaff(s.edition.id, 'show_team', ['helpdesk']);
    setAssistantModelForTests(
      new ScriptedModel([
        () => tool('search_manual', { query: 'coach parking' }),
        () => tool('log_unanswered', { question: 'Is there coach parking?' }),
        () => tool('propose_contact_team', { subject: 'Coach parking', message: 'Is there parking for a coach on build-up day?' }),
        () => text('I could not find that, so I have written it up for the show team.'),
      ]),
    );
    const r = await askAssistant(actorFor(s.a.user), s.a.stand.id, { text: 'Is there coach parking?' });
    const msg = r.messages[1];
    expect(msg.meta.ticket).toEqual({ subject: 'Coach parking', message: 'Is there parking for a coach on build-up day?' });
    expect(msg.meta.unanswered).toEqual(['Is there coach parking?']);
    const sent = await sendTicketProposal(actorFor(s.a.user), s.a.stand.id, msg.id);
    expect(sent.number).toMatch(/^HD-/);
    const db = await getDb();
    const [t] = await db.select().from(tickets).where(eq(tickets.id, sent.ticketId));
    expect(t).toMatchObject({ source: 'assistant', subject: 'Coach parking' });
    await expect(sendTicketProposal(actorFor(s.a.user), s.a.stand.id, msg.id)).rejects.toThrow(/already/);

    // The team answers the question; the assistant uses the answer next time.
    const insights = await assistantInsights(actorFor(desk), s.edition.id);
    expect(insights.unanswered.map((u) => u.question)).toEqual(['Is there coach parking?']);
    expect(insights.stats).toMatchObject({ conversations: 1, people: 1, questions: 1 });
    await resolveUnanswered(actorFor(desk), s.edition.id, insights.unanswered[0].id, 'Yes, in the Orange car park, bookable with the venue.');
    expect((await assistantInsights(actorFor(desk), s.edition.id)).unanswered).toEqual([]);
    expect(await db.select().from(assistantFaqs).where(eq(assistantFaqs.editionId, s.edition.id))).toHaveLength(1);
    const model = new ScriptedModel([() => tool('search_manual', { query: 'coach parking' }), () => text('Yes, in the Orange car park.')]);
    setAssistantModelForTests(model);
    await askAssistant(actorFor(s.b.user), s.b.stand.id, { text: 'Coach parking?' });
    expect(lastToolResult(model.requests[1])!.content).toContain('Orange car park');

    // Reading chats needs the help desk permission, and is recorded.
    const writer = actorFor(await makeStaff(s.edition.id, 'show_team', ['edit_content']));
    expect((await assistantInsights(writer, s.edition.id)).conversations).toEqual([]);
    await expect(conversationForStaff(writer, r.conversationId)).rejects.toThrow();
    const chat = await conversationForStaff(actorFor(desk), r.conversationId);
    expect(chat.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, 'assistant.conversation_viewed'))).toHaveLength(1);
    expect(await db.select().from(assistantUnanswered).where(eq(assistantUnanswered.editionId, s.edition.id))).toHaveLength(1);
  });

  it('respects switches, limits and failures', async () => {
    const s = await showWithManual();
    setAssistantModelForTests(new ScriptedModel([]));
    await expect(askAssistant(actorFor(s.a.user, { readOnly: true }), s.a.stand.id, { text: 'Hi' })).rejects.toThrow(/viewing as someone else/);
    await expect(askAssistant(actorFor(s.a.user), s.a.stand.id, { text: ' ' })).rejects.toThrow();

    // A failing model saves nothing and gives a friendly message.
    await expect(askAssistant(actorFor(s.a.user), s.a.stand.id, { text: 'Hello?' })).rejects.toThrow(/not available right now/);
    const db = await getDb();
    expect(await db.select().from(assistantMessages)).not.toContainEqual(expect.objectContaining({ content: 'Hello?' }));

    await consumeRateLimit(`assistant:user-hour:${s.b.user.id}`, 30, 3600, 30);
    await expect(askAssistant(actorFor(s.b.user), s.b.stand.id, { text: 'Hi' })).rejects.toThrow(/Too many/);

    await db.update(editions).set({ assistantEnabled: false }).where(eq(editions.id, s.edition.id));
    expect(await assistantView(actorFor(s.a.user), s.a.stand.id)).toMatchObject({ available: false, reason: 'The assistant is switched off for this show.' });
    await expect(askAssistant(actorFor(s.a.user), s.a.stand.id, { text: 'Hi' })).rejects.toThrow(/switched off/);
    await db.update(editions).set({ assistantEnabled: true }).where(eq(editions.id, s.edition.id));

    const superAdmin = actorFor(await makeUser({ isSuperAdmin: true }));
    await updatePlatformSettings(superAdmin, { assistantEnabled: false });
    expect(await assistantView(actorFor(s.a.user), s.a.stand.id)).toMatchObject({ available: false });
    await updatePlatformSettings(superAdmin, { assistantEnabled: true });

    setAssistantModelForTests(null);
    expect(await assistantView(actorFor(s.a.user), s.a.stand.id)).toMatchObject({ available: false, reason: 'The assistant has not been set up (no Claude API key).' });
  });

  it('works end to end with the offline model used in development', async () => {
    const s = await showWithManual();
    setAssistantModelForTests(new OfflineModel());
    const r = await askAssistant(actorFor(s.a.user), s.a.stand.id, { text: 'Which entrance do deliveries use?' });
    expect(r.messages[1].content).toContain('Eastern entrance');
    expect(r.messages[1].content).toContain(`(/portal/${s.edition.slug}/manual/deliveries)`);
    const due = await askAssistant(actorFor(s.a.user), s.a.stand.id, { text: 'What is due next?' });
    expect(due.messages[1].content).toContain('Fascia name board');
  });

  it('nudges about each deadline step once, in the portal', async () => {
    const s = await showWithManual();
    const me = actorFor(s.a.user);
    const first = await pendingNudges(me, s.a.stand.id);
    expect(first.map((n) => [n.title, n.step])).toEqual([['Fascia name board', 'd7']]);
    // Shown until the page records it as seen.
    expect(await pendingNudges(me, s.a.stand.id)).toHaveLength(1);
    await recordNudges(me, s.a.stand.id, first.map((n) => ({ taskId: n.taskId, step: n.step })));
    expect(await pendingNudges(me, s.a.stand.id)).toEqual([]);
    // Another stand has its own.
    expect((await pendingNudges(actorFor(s.b.user), s.b.stand.id)).map((n) => n.title)).toEqual(['Fascia name board']);
    // A task that is not on the stand's checklist cannot be recorded for it.
    await recordNudges(actorFor(s.p.user), s.p.stand.id, [{ taskId: s.form.id, step: 'd7' }]);
    const db = await getDb();
    expect(await db.select().from(reminderLog).where(eq(reminderLog.standId, s.p.stand.id))).toEqual([]);
    await expect(recordNudges(me, s.a.stand.id, [{ taskId: 'not-a-uuid', step: 'd7' }])).rejects.toThrow();
    expect(await pendingNudges(actorFor(s.a.user, { readOnly: true }), s.a.stand.id)).toEqual([]);
    // Later, the one-day step nudges again.
    const later = await pendingNudges(me, s.a.stand.id, new Date(Date.now() + 4.5 * DAY));
    expect(later.map((n) => n.step)).toEqual(['d1']);
  });
});
