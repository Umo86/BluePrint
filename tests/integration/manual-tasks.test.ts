import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb, useInMemoryDatabaseForTests } from '@/server/db/client';
import { editions, emailOutbox, libraryItems, manualPages, tasks } from '@/server/db/schema';
import { createPage, deletePage, pageForType, pagesForType, updatePage } from '@/server/services/manual';
import { copyTaskFromLibrary, createTask, deleteTask, listTasks, updateTask, type TaskInput } from '@/server/services/tasks';
import {
  checklistForStand,
  exportResponses,
  extendDeadlineForStand,
  markTask,
  reopenForStand,
  responsesForTask,
  reviewSubmission,
  saveAnswers,
  taskForStand,
} from '@/server/services/submissions';
import { resolvePortal } from '@/server/services/portal';
import { beginUpload, completeUpload, receiveLocalUpload } from '@/server/services/files';
import { MemoryStorage, setStorageForTests } from '@/server/storage';
import { validateAnswers, isVisible, type FormField } from '@/lib/forms';
import { actorFor, makeEdition, makeExhibitor, makeStaff, makeUser } from '../support/factories';

beforeAll(async () => {
  await useInMemoryDatabaseForTests();
});
afterAll(closeDb);
afterEach(() => setStorageForTests(null));

const FORM: FormField[] = [
  { id: 'intro', type: 'heading', label: 'Your stand team' },
  { id: 'manager', type: 'text', label: 'Stand manager', required: true },
  { id: 'email', type: 'email', label: 'Manager email', required: true },
  { id: 'vehicle', type: 'select', label: 'Delivery vehicle', options: ['Van', 'Lorry'], required: true },
  { id: 'lorry_reg', type: 'text', label: 'Lorry registration', required: true, showIf: { fieldId: 'vehicle', equals: 'Lorry' } },
  { id: 'staff', type: 'repeater', label: 'Staff', fields: [{ id: 'name', type: 'text', label: 'Name', required: true }], maxRows: 3 },
  { id: 'decl', type: 'declaration', label: 'Declaration', statement: 'I confirm.', required: true },
];

function taskInput(over: Partial<TaskInput> & { requirements: Record<string, 'required' | 'if_applicable' | 'optional' | 'hidden'> }): TaskInput {
  return {
    title: 'Stand team details',
    kind: 'form',
    formSchema: FORM,
    deadline: { mode: 'offset', offsetDays: 14 },
    published: true,
    ...over,
  };
}

describe('form answers', () => {
  it('checks required questions only on submit, and follows conditions', () => {
    const draft = validateAnswers(FORM, { manager: 'Ann' }, { submit: false });
    expect(draft.ok).toBe(true);
    const submit = validateAnswers(FORM, { manager: 'Ann', email: 'not-email', vehicle: 'Van' }, { submit: true });
    expect(submit.errors).toMatchObject({ email: 'Enter a valid email address.', decl: expect.any(String) });
    expect(submit.errors.lorry_reg).toBeUndefined();
    const lorry = validateAnswers(FORM, { manager: 'Ann', email: 'a@b.co', vehicle: 'Lorry', decl: { agreed: true, name: 'Ann Lee' } }, { submit: true });
    expect(lorry.errors).toEqual({ lorry_reg: 'This is required.' });
    expect(isVisible(FORM[4], { vehicle: 'Van' })).toBe(false);
  });

  it('drops unknown answers and rejects options, rows and values that do not fit', () => {
    const r = validateAnswers(FORM, { manager: 'Ann', hacker: '<script>', vehicle: 'Helicopter', staff: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }] }, { submit: false });
    expect(r.errors.vehicle).toMatch(/Choose one/);
    expect(r.errors.staff).toMatch(/up to 3 rows/);
    expect(r.clean).not.toHaveProperty('hacker');
  });
});

describe('manual pages', () => {
  it('shows each page only to the stand types it is for, and cleans the HTML', async () => {
    const { edition, shell, space } = await makeEdition();
    const editor = await makeStaff(edition.id, 'show_team', ['edit_content']);
    const viewer = await makeStaff(edition.id, 'show_team', []);
    const general = await createPage(actorFor(editor), edition.id, { title: 'Venue information', bodyHtml: '<p>Hello<img src="x" onerror="alert(1)"></p>' });
    expect(general.bodyHtml).toBe('<p>Hello</p>');
    const spaceOnly = await createPage(actorFor(editor), edition.id, { title: 'Building your stand', bodyHtml: '<p>Rules</p>', visibleToTypes: [space.id] });
    const dupe = await createPage(actorFor(editor), edition.id, { title: 'Venue information', bodyHtml: '' });
    expect(dupe.slug).toBe('venue-information-2');
    await createPage(actorFor(editor), edition.id, { title: 'Draft page', bodyHtml: '', published: false });
    expect((await pagesForType(edition.id, shell.id)).map((p) => p.title)).toEqual(['Venue information', 'Venue information']);
    expect((await pagesForType(edition.id, space.id)).map((p) => p.title)).toContain('Building your stand');
    expect(await pageForType(edition.id, shell.id, spaceOnly.slug)).toBeNull();
    await expect(createPage(actorFor(viewer), edition.id, { title: 'Nope', bodyHtml: '' })).rejects.toThrow();
    const other = await makeEdition();
    await expect(updatePage(actorFor(editor), general.id, { title: 'X', bodyHtml: '', visibleToTypes: [other.shell.id] })).rejects.toThrow(/stand types from this show/);
    await deletePage(actorFor(editor), dupe.id);
  });
});

describe('tasks and the exhibitor checklist', () => {
  it('builds tasks per stand type and validates them before publishing', async () => {
    const { edition, shell, space } = await makeEdition();
    const editor = await makeStaff(edition.id, 'show_team', ['edit_content']);
    await expect(createTask(actorFor(editor), edition.id, taskInput({ formSchema: [], requirements: { [shell.id]: 'required' } }))).rejects.toThrow(/at least one question/);
    await expect(
      createTask(actorFor(editor), edition.id, taskInput({ formSchema: [{ id: 'x', type: 'select', label: 'Pick' }], requirements: {} })),
    ).rejects.toThrow();
    const t = await createTask(actorFor(editor), edition.id, taskInput({ requirements: { [shell.id]: 'required', [space.id]: 'if_applicable' } }));
    const fixed = await createTask(actorFor(editor), edition.id, taskInput({ title: 'Fixed', deadline: { mode: 'fixed', at: '2027-04-01 17:00' }, requirements: { [shell.id]: 'optional' } }));
    const db = await getDb();
    const [f] = await db.select().from(tasks).where(eq(tasks.id, fixed.id));
    expect(f.deadlineAt?.toISOString()).toBe('2027-04-01T16:00:00.000Z');
    const list = await listTasks(actorFor(editor), edition.id);
    expect(list.find((x) => x.task.id === t.id)?.requirements).toEqual({ [shell.id]: 'required', [space.id]: 'if_applicable' });

    const shellEx = await makeExhibitor(edition.id, shell.id);
    const spaceEx = await makeExhibitor(edition.id, space.id);
    const shellList = await checklistForStand(actorFor(shellEx.user), shellEx.stand.id);
    expect(shellList.items.map((i) => i.task.title)).toEqual(['Stand team details', 'Fixed']);
    expect(shellList.progress).toMatchObject({ required: 1, requiredDone: 0 });
    const spaceList = await checklistForStand(actorFor(spaceEx.user), spaceEx.stand.id);
    expect(spaceList.items.map((i) => i.requirement)).toEqual(['if_applicable']);
    // Other companies cannot see the stand at all.
    await expect(checklistForStand(actorFor(spaceEx.user), shellEx.stand.id)).rejects.toThrow();
    // Optional and if-applicable tasks can be marked as not needed; required ones cannot.
    await markTask(actorFor(spaceEx.user), spaceEx.stand.id, t.id, 'not_needed');
    await expect(markTask(actorFor(shellEx.user), shellEx.stand.id, t.id, 'not_needed')).rejects.toThrow(/required/);
    await markTask(actorFor(spaceEx.user), spaceEx.stand.id, t.id, 'undo');
  });

  it('runs the whole draft, submit, review and resubmit cycle with emails', async () => {
    const { edition, shell } = await makeEdition();
    const editor = await makeStaff(edition.id, 'show_team', ['edit_content', 'manage_exhibitors']);
    const t = await createTask(actorFor(editor), edition.id, taskInput({ requiresApproval: true, requirements: { [shell.id]: 'required' } }));
    const ex = await makeExhibitor(edition.id, shell.id);
    const me = actorFor(ex.user);
    await saveAnswers(me, ex.stand.id, t.id, { manager: 'Ann' }, { submit: false });
    expect((await taskForStand(me, ex.stand.id, t.id)).state).toBe('draft');
    await expect(saveAnswers(me, ex.stand.id, t.id, { manager: 'Ann' }, { submit: true })).rejects.toThrow(/highlighted/);
    const answers = { manager: 'Ann', email: 'ann@example.com', vehicle: 'Van', staff: [{ name: 'Bo' }], decl: { agreed: true, name: 'Ann Lee' } };
    const sent = await saveAnswers(me, ex.stand.id, t.id, answers, { submit: true });
    expect(sent.status).toBe('submitted');
    expect((sent.data.decl as { signedAt?: string }).signedAt).toBeTruthy();
    // Once sent it cannot be quietly changed as a draft.
    await expect(saveAnswers(me, ex.stand.id, t.id, answers, { submit: false })).rejects.toThrow(/already been sent/);

    await expect(reviewSubmission(actorFor(editor), t.id, ex.stand.id, 'changes_needed', '')).rejects.toThrow(/what needs to change/);
    await reviewSubmission(actorFor(editor), t.id, ex.stand.id, 'changes_needed', 'Please add a second staff member.');
    const db = await getDb();
    const mail = await db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, ex.user.email));
    expect(mail.map((m) => m.subject)).toContain('Changes needed: Stand team details');
    expect(mail.find((m) => m.subject.startsWith('Changes needed'))!.text).toContain('Please add a second staff member.');
    const again = await saveAnswers(me, ex.stand.id, t.id, { ...answers, staff: [{ name: 'Bo' }, { name: 'Cy' }] }, { submit: true });
    expect(again.version).toBe(2);
    await reviewSubmission(actorFor(editor), t.id, ex.stand.id, 'approved', null);
    const locked = await taskForStand(me, ex.stand.id, t.id);
    expect(locked.editable).toBe(false);
    await expect(saveAnswers(me, ex.stand.id, t.id, answers, { submit: true })).rejects.toThrow(/approved/);
    // The team can reopen it for this stand.
    await reopenForStand(actorFor(editor), t.id, ex.stand.id, new Date(Date.now() + 3600_000));
    expect((await taskForStand(me, ex.stand.id, t.id)).editable).toBe(true);

    const responses = await responsesForTask(actorFor(editor), t.id);
    expect(responses.rows).toHaveLength(1);
    const exported = await exportResponses(actorFor(editor), t.id);
    expect(exported.header.slice(0, 5)).toEqual(['Stand', 'Company', 'Status', 'Submitted', 'Late']);
    expect(exported.body[0]).toContain('Ann');
  });

  it('locks answers after the deadline unless the stand gets more time', async () => {
    const { edition, shell } = await makeEdition();
    const editor = await makeStaff(edition.id, 'show_team', ['edit_content', 'manage_exhibitors']);
    const t = await createTask(actorFor(editor), edition.id, taskInput({ deadline: { mode: 'fixed', at: '2020-01-01 12:00' }, requirements: { [shell.id]: 'required' } }));
    const ex = await makeExhibitor(edition.id, shell.id);
    const state = await taskForStand(actorFor(ex.user), ex.stand.id, t.id);
    expect(state.state).toBe('overdue');
    expect(state.editable).toBe(false);
    await expect(saveAnswers(actorFor(ex.user), ex.stand.id, t.id, { manager: 'A' }, { submit: false })).rejects.toThrow(/deadline has passed/);
    await extendDeadlineForStand(actorFor(editor), t.id, ex.stand.id, new Date(Date.now() + 86400_000));
    expect((await taskForStand(actorFor(ex.user), ex.stand.id, t.id)).editable).toBe(true);
    // A task that does not lock stays open after its deadline.
    await updateTask(actorFor(editor), t.id, taskInput({ deadline: { mode: 'fixed', at: '2020-01-01 12:00' }, locksAtDeadline: false, requirements: { [shell.id]: 'required' } }));
    const other = await makeExhibitor(edition.id, shell.id);
    expect((await taskForStand(actorFor(other.user), other.stand.id, t.id)).editable).toBe(true);
  });

  it('refuses changes while viewing as someone, after the show closes, and with other stands’ files', async () => {
    const mem = new MemoryStorage();
    setStorageForTests(mem);
    const { edition, shell } = await makeEdition();
    const editor = await makeStaff(edition.id, 'show_team', ['edit_content']);
    const t = await createTask(
      actorFor(editor),
      edition.id,
      taskInput({ kind: 'upload', formSchema: [{ id: 'doc', type: 'file', label: 'Risk assessment', required: true }], requirements: { [shell.id]: 'required' } }),
    );
    const a = await makeExhibitor(edition.id, shell.id);
    const b = await makeExhibitor(edition.id, shell.id);
    const pdf = new TextEncoder().encode('%PDF-1.4\n%%EOF\n');
    const up = await beginUpload(actorFor(b.user), { purpose: 'submission', filename: 'b.pdf', contentType: 'application/pdf', size: pdf.length, standId: b.stand.id });
    await receiveLocalUpload(actorFor(b.user), up.fileId, pdf);
    await completeUpload(actorFor(b.user), up.fileId);
    await expect(saveAnswers(actorFor(a.user), a.stand.id, t.id, { doc: [up.fileId] }, { submit: true })).rejects.toThrow(/could not be found/);
    const own = await beginUpload(actorFor(a.user), { purpose: 'submission', filename: 'a.pdf', contentType: 'application/pdf', size: pdf.length, standId: a.stand.id });
    await receiveLocalUpload(actorFor(a.user), own.fileId, pdf);
    await completeUpload(actorFor(a.user), own.fileId);
    await saveAnswers(actorFor(a.user), a.stand.id, t.id, { doc: [own.fileId] }, { submit: true });

    await expect(saveAnswers(actorFor(a.user, { readOnly: true, realUserId: editor.id, viewAsEditionId: a.stand.editionId }), a.stand.id, t.id, { doc: [own.fileId] }, { submit: true })).rejects.toThrow();
    const db = await getDb();
    await db.update(editions).set({ status: 'closed' }).where(eq(editions.id, edition.id));
    await expect(saveAnswers(actorFor(a.user), a.stand.id, t.id, { doc: [own.fileId] }, { submit: true })).rejects.toThrow(/not open/);
    const portal = await resolvePortal(actorFor(a.user), edition.slug);
    expect(portal.editable).toBe(false);
    await db.update(editions).set({ status: 'draft' }).where(eq(editions.id, edition.id));
    await expect(resolvePortal(actorFor(a.user), edition.slug)).rejects.toThrow();
  });

  it('copies tasks from the library by stand type, and protects answered tasks from deletion', async () => {
    const { edition, shell, space } = await makeEdition();
    const editor = await makeStaff(edition.id, 'show_team', ['edit_content']);
    const db = await getDb();
    const [item] = await db
      .insert(libraryItems)
      .values({ kind: 'task', name: 'Risk assessment', data: { title: 'Risk assessment', kind: 'upload', formSchema: [{ id: 'f', type: 'file', label: 'File' }], deadlineOffsetDays: 21, requirementsByKey: { space_only: 'required' } } })
      .returning();
    const copy = await copyTaskFromLibrary(actorFor(editor), edition.id, item.id);
    expect(copy.published).toBe(false);
    expect(copy.deadlineOffsetDays).toBe(21);
    const list = await listTasks(actorFor(editor), edition.id);
    expect(list.find((x) => x.task.id === copy.id)?.requirements).toEqual({ [space.id]: 'required' });

    const t = await createTask(actorFor(editor), edition.id, taskInput({ requirements: { [shell.id]: 'required' } }));
    const ex = await makeExhibitor(edition.id, shell.id);
    await saveAnswers(actorFor(ex.user), ex.stand.id, t.id, { manager: 'A', email: 'a@b.co', vehicle: 'Van', decl: { agreed: true, name: 'A' } }, { submit: true });
    await expect(deleteTask(actorFor(editor), t.id)).rejects.toThrow(/Unpublish it instead/);
    await deleteTask(actorFor(editor), copy.id);
    const pageCount = await db.select().from(manualPages).where(and(eq(manualPages.editionId, edition.id)));
    expect(pageCount).toHaveLength(0);
    const stranger = await makeUser();
    await expect(listTasks(actorFor(stranger), edition.id)).rejects.toThrow();
  });
});
