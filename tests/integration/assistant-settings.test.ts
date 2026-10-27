import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb, useInMemoryDatabaseForTests } from '@/server/db/client';
import { assistantConversations, assistantMessages, assistantUnanswered, auditLog, editions, manualPages, taskRequirements, tasks, tickets, ticketMessages } from '@/server/db/schema';
import {
  applyFormProposal,
  askAssistant,
  askAssistantAsTest,
  assistantInsights,
  assistantView,
  conversationForStaff,
  resetTestConversation,
  saveAssistantSettings,
  sendTicketProposal,
  testAssistantView,
  testCandidates,
} from '@/server/assistant';
import { checkAssistantConnection, platformAssistantOverview } from '@/server/assistant/admin';
import { setAssistantModelForTests, resetAssistantModelForTests, type AssistantModel, type ModelReply, type ModelRequest } from '@/server/assistant/model';
import { cloneEdition } from '@/server/services/editions';
import { updatePlatformSettings } from '@/server/services/settings';
import { estimateCostUsd } from '@/lib/assistant-pricing';
import type { AssistantSettingsInput } from '@/lib/assistant-config';
import { actorFor, makeEdition, makeExhibitor, makeStaff, makeUser } from '../support/factories';

const DAY = 86_400_000;

beforeAll(async () => {
  await useInMemoryDatabaseForTests();
});
afterAll(closeDb);
afterEach(() => resetAssistantModelForTests());

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
const usage = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 3000, cacheWriteTokens: 0 };
const tool = (name: string, input: Record<string, unknown>): ModelReply => ({ content: [{ type: 'tool_use', id: `toolu_${name}`, name, input }], stopReason: 'tool_use', usage, model: 'claude-sonnet-5-5' });
const text = (t: string): ModelReply => ({ content: [{ type: 'text', text: t }], stopReason: 'end_turn', usage, model: 'claude-sonnet-5-5' });
const lastToolResult = (req: ModelRequest) => {
  const m = req.messages[req.messages.length - 1];
  return Array.isArray(m.content) ? (m.content[0] as { content: string; is_error?: boolean }) : null;
};

const SETTINGS: AssistantSettingsInput = {
  enabled: true,
  name: 'Expo helper',
  greeting: 'Hi {first_name}, ask me anything about Demo Expo.',
  suggestions: ['Where do I park?', 'When can I build?'],
  instructions: 'Call us the Demo Expo team. For urgent problems on site, call 020 7946 0999.',
  dailyLimit: null,
  officeHours: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:30' },
  replyTime: 'hours4',
  askPhone: true,
};

async function show() {
  const { edition, shell } = await makeEdition();
  const db = await getDb();
  await db.insert(manualPages).values({ editionId: edition.id, title: 'Deliveries', slug: 'deliveries', bodyHtml: '<p>Deliveries use the Eastern entrance.</p>' });
  const [form] = await db
    .insert(tasks)
    .values({ editionId: edition.id, title: 'Fascia name board', kind: 'form', deadlineAt: new Date(Date.now() + 5 * DAY), formSchema: [{ id: 'fascia', type: 'text', label: 'Name on the fascia', required: true }] as never })
    .returning();
  await db.insert(taskRequirements).values({ taskId: form.id, exhibitorTypeId: shell.id, requirement: 'required' });
  const a = await makeExhibitor(edition.id, shell.id, 'A1');
  const b = await makeExhibitor(edition.id, shell.id, 'B2');
  const admin = await makeStaff(edition.id, 'show_admin');
  return { edition, shell, form, a, b, admin };
}

describe('the show’s AI assistant settings', () => {
  it('are set by people who edit content, and shape what exhibitors see and what Claude is told', async () => {
    const s = await show();
    const superAdmin = actorFor(await makeUser({ isSuperAdmin: true }));
    await updatePlatformSettings(superAdmin, { assistantInstructions: 'Never promise refunds.' });

    // Only people who can edit content, never while viewing as someone else, and never above the platform's ceiling.
    const desk = actorFor(await makeStaff(s.edition.id, 'show_team', ['helpdesk']));
    await expect(saveAssistantSettings(desk, s.edition.id, SETTINGS)).rejects.toThrow();
    await expect(saveAssistantSettings(actorFor(s.admin, { readOnly: true }), s.edition.id, SETTINGS)).rejects.toThrow();
    await expect(saveAssistantSettings(actorFor(s.admin), s.edition.id, { ...SETTINGS, dailyLimit: 999_999 })).rejects.toThrow();
    await expect(saveAssistantSettings(actorFor(s.admin), s.edition.id, { ...SETTINGS, dailyLimit: 5000 })).rejects.toThrow(/The most any show can have is 3000/);
    await saveAssistantSettings(actorFor(s.admin), s.edition.id, SETTINGS);
    const db = await getDb();
    const [audit] = await db.select().from(auditLog).where(and(eq(auditLog.action, 'assistant.settings_updated'), eq(auditLog.entityId, s.edition.id)));
    expect((audit.details as { changed: string[] }).changed).toEqual(expect.arrayContaining(['name', 'greeting', 'instructions', 'replyTime']));

    // The exhibitor sees the show's name, greeting and suggestions (their next task first).
    setAssistantModelForTests(new ScriptedModel([]));
    const view = await assistantView(actorFor(s.a.user), s.a.stand.id);
    if (!view.available) throw new Error('expected the assistant');
    expect(view.name).toBe('Expo helper');
    expect(view.greeting.text).toBe('Hi Main, ask me anything about Demo Expo.');
    expect(view.greeting.suggestions).toEqual(['Help me with “Fascia name board”', 'Where do I park?', 'When can I build?']);
    expect(view.handoff.askPhone).toBe(true);
    expect(view.handoff.expectation).toMatch(/^The show team (is in until 17:30 today|is out of the office now)/);

    // Claude gets the house rules in their own block, and the office hours with this exhibitor's details.
    const model = new ScriptedModel([() => text('Here to help.')]);
    setAssistantModelForTests(model);
    await askAssistant(actorFor(s.a.user), s.a.stand.id, { text: 'Hello' });
    const req = model.requests[0];
    expect(req.system.rules).toContain('“Expo helper”');
    expect(req.system.rules).toContain("The organiser's instructions for every show:\nNever promise refunds.");
    expect(req.system.rules).toContain("The show team's instructions for this show:\nCall us the Demo Expo team.");
    expect(req.system.stable).toContain('these rules always win');
    expect(req.system.dynamic).toContain('Show team office hours: Monday to Friday, 09:00 to 17:30 (UK time).');

    // Switching it off here hides it from exhibitors.
    await saveAssistantSettings(actorFor(s.admin), s.edition.id, { ...SETTINGS, enabled: false });
    expect(await assistantView(actorFor(s.a.user), s.a.stand.id)).toMatchObject({ available: false, reason: 'The assistant is switched off for this show.' });

    // Next year's edition keeps the set-up.
    const next = await cloneEdition(superAdmin, s.edition.id, { name: 'Demo Expo 2028', copyStaff: false });
    const [copy] = await db.select().from(editions).where(eq(editions.id, next.id));
    expect(copy).toMatchObject({ assistantEnabled: false, assistantSettings: expect.objectContaining({ name: 'Expo helper', replyTime: 'hours4' }) });
  });

  it('passes questions on with a phone number and a good time to call, and says when the team replies', async () => {
    const s = await show();
    await saveAssistantSettings(actorFor(s.admin), s.edition.id, SETTINGS);
    const model = new ScriptedModel([
      () => tool('propose_contact_team', { subject: 'Rigging', message: 'Can we hang a banner?' }),
      (req) => {
        expect(lastToolResult(req)!.content).toMatch(/Tell them when to expect an answer: The show team/);
        return text('I have written that up for the show team.');
      },
    ]);
    setAssistantModelForTests(model);
    const r = await askAssistant(actorFor(s.a.user), s.a.stand.id, { text: 'Can we hang a banner?' });
    const msg = r.messages[1];
    await expect(sendTicketProposal(actorFor(s.a.user), s.a.stand.id, msg.id, { phone: 'call me maybe' })).rejects.toThrow();
    const sent = await sendTicketProposal(actorFor(s.a.user), s.a.stand.id, msg.id, { phone: '+44 7700 900123', bestTime: 'Weekday mornings' });
    expect(sent.expectation).toMatch(/^The show team/);
    const db = await getDb();
    const [t] = await db.select().from(tickets).where(eq(tickets.id, sent.ticketId));
    expect(t).toMatchObject({ source: 'assistant', subject: 'Rigging', contactPhone: '+44 7700 900123' });
    const [first] = await db.select().from(ticketMessages).where(eq(ticketMessages.ticketId, t.id));
    expect(first.body).toBe('Can we hang a banner?\n\nBest time to call: Weekday mornings\n\n(Sent from a conversation with the BluePrint assistant.)');
  });

  it('keeps to the limits set for people and for the show', async () => {
    const s = await show();
    const superAdmin = actorFor(await makeUser({ isSuperAdmin: true }));
    await updatePlatformSettings(superAdmin, { assistantPersonHourLimit: 2 });
    setAssistantModelForTests(new ScriptedModel([() => text('One.'), () => text('Two.')]));
    await askAssistant(actorFor(s.a.user), s.a.stand.id, { text: 'One?' });
    await askAssistant(actorFor(s.a.user), s.a.stand.id, { text: 'Two?' });
    await expect(askAssistant(actorFor(s.a.user), s.a.stand.id, { text: 'Three?' })).rejects.toThrow(/a lot of questions in a short time/);
    await updatePlatformSettings(superAdmin, { assistantPersonHourLimit: 30 });

    // This show allows two a day in all, and two have been answered.
    await saveAssistantSettings(actorFor(s.admin), s.edition.id, { ...SETTINGS, dailyLimit: 2 });
    setAssistantModelForTests(new ScriptedModel([() => text('Hi.')]));
    await expect(askAssistant(actorFor(s.b.user), s.b.stand.id, { text: 'Hello?' })).rejects.toThrow(/as many questions as it can for this show today/);
  });

  it('lets the team try it as an exhibitor without anything reaching the exhibitor or the help desk', async () => {
    const s = await show();
    const db = await getDb();
    // Testing works before the show's assistant is switched on.
    await saveAssistantSettings(actorFor(s.admin), s.edition.id, { ...SETTINGS, enabled: false });
    const tester = actorFor(await makeStaff(s.edition.id, 'show_team', ['manage_exhibitors', 'helpdesk']));
    const people = await testCandidates(tester, s.edition.id);
    expect(people.map((p) => p.standNumber)).toEqual(['A1', 'B2']);
    // Needs permission to manage exhibitors, and is never possible while viewing as someone else.
    const writer = actorFor(await makeStaff(s.edition.id, 'show_team', ['edit_content']));
    await expect(testCandidates(writer, s.edition.id)).rejects.toThrow(/manage exhibitors/);
    await expect(askAssistantAsTest(actorFor(s.admin, { readOnly: true }), s.edition.id, { standId: s.a.stand.id, userId: s.a.user.id, text: 'Hi' })).rejects.toThrow();
    // Someone who is not on that stand cannot be chosen.
    await expect(testAssistantView(tester, s.edition.id, s.a.stand.id, s.b.user.id)).rejects.toThrow();

    const v = await testAssistantView(tester, s.edition.id, s.a.stand.id, s.a.user.id);
    if (!v.available) throw new Error('expected the test chat');
    expect(v).toMatchObject({ test: true, name: 'Expo helper', messages: [] });
    expect(v.greeting.text).toBe('Hi Main, ask me anything about Demo Expo.');

    const model = new ScriptedModel([
      () => tool('my_checklist', {}),
      (req) => {
        // The tools see the exhibitor's own checklist.
        expect(lastToolResult(req)!.content).toContain('Fascia name board');
        return tool('log_unanswered', { question: 'Is there a crèche?' });
      },
      () => tool('propose_form_answers', { task_id: s.form.id, answers: { fascia: 'TEST CO' } }),
      () => text('Your fascia form is next.'),
    ]);
    setAssistantModelForTests(model);
    const r = await askAssistantAsTest(tester, s.edition.id, { standId: s.a.stand.id, userId: s.a.user.id, text: 'What is next?' });
    expect(r.messages[1].content).toBe('Your fascia form is next.');
    expect(r.messages[1].meta.proposals).toHaveLength(1);
    expect(model.requests[0].system.dynamic).toContain('You are talking to Main contact A1');
    const [conv] = await db.select().from(assistantConversations).where(eq(assistantConversations.id, r.conversationId));
    expect(conv).toMatchObject({ isTest: true, userId: tester.realUserId, standId: s.a.stand.id });
    // Not recorded as a real unanswered question, and the exhibitor cannot see or use it.
    expect(await db.select().from(assistantUnanswered).where(eq(assistantUnanswered.editionId, s.edition.id))).toEqual([]);
    await saveAssistantSettings(actorFor(s.admin), s.edition.id, SETTINGS);
    setAssistantModelForTests(new ScriptedModel([]));
    const own = await assistantView(actorFor(s.a.user), s.a.stand.id);
    expect(own.available && own.messages).toEqual([]);
    await expect(applyFormProposal(actorFor(s.a.user), s.a.stand.id, r.messages[1].id, 0)).rejects.toThrow();
    await expect(conversationForStaff(tester, r.conversationId)).rejects.toThrow();

    // Left out of the show's figures, apart from what it cost.
    const insights = await assistantInsights(tester, s.edition.id);
    expect(insights.stats.questions).toBe(0);
    expect(insights.month.testQuestions).toBe(1);
    expect(insights.conversations).toEqual([]);
    expect(insights.month.costUsd).toBeCloseTo(estimateCostUsd('claude-sonnet-5-5', { inputTokens: 400, outputTokens: 80, cacheReadTokens: 12_000, cacheWriteTokens: 0 }));

    // Starting again clears the test chat.
    await resetTestConversation(tester, s.edition.id, s.a.stand.id);
    const fresh = await testAssistantView(tester, s.edition.id, s.a.stand.id, s.a.user.id);
    expect(fresh.available && fresh.messages).toEqual([]);
  });

  it('shows the super admin usage and cost for every show, and checks the connection to Claude', async () => {
    const s = await show();
    setAssistantModelForTests(new ScriptedModel([() => text('Hello.')]));
    await askAssistant(actorFor(s.a.user), s.a.stand.id, { text: 'Hi' });
    const superAdmin = actorFor(await makeUser({ isSuperAdmin: true }));
    await expect(platformAssistantOverview(actorFor(s.admin))).rejects.toThrow();
    const overview = await platformAssistantOverview(superAdmin);
    const row = overview.editions.find((e) => e.id === s.edition.id)!;
    expect(row.usage).toMatchObject({ questions: 1, people: 1, testQuestions: 0 });
    expect(row.usage.costUsd).toBeCloseTo(estimateCostUsd('claude-sonnet-5-5', usage));
    expect(overview.total.costUsd).toBeGreaterThanOrEqual(row.usage.costUsd);

    await expect(checkAssistantConnection(actorFor(s.admin))).rejects.toThrow();
    setAssistantModelForTests(null);
    expect(await checkAssistantConnection(superAdmin)).toMatchObject({ ok: false, message: expect.stringMatching(/No Claude API key/) });
    setAssistantModelForTests(new ScriptedModel([() => text('OK')]));
    expect(await checkAssistantConnection(superAdmin)).toMatchObject({ ok: true, message: expect.stringMatching(/^Connected\. Claude Sonnet 5\.5 answered in/) });
    const refused = Object.assign(new Error('invalid x-api-key'), { status: 401 });
    setAssistantModelForTests({ kind: 'claude', reply: async () => Promise.reject(refused) });
    expect(await checkAssistantConnection(superAdmin)).toMatchObject({ ok: false, message: expect.stringMatching(/refused the key/) });
    const db = await getDb();
    expect(await db.select().from(auditLog).where(eq(auditLog.action, 'assistant.connection_checked'))).toHaveLength(3);
    expect(await db.select().from(assistantMessages)).not.toHaveLength(0);
  });
});
