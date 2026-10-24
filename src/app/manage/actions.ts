'use server';

import { revalidatePath } from 'next/cache';
import type { z } from 'zod';
import { runAction, type ActionResult } from '@/server/actions';
import { requireActor } from '@/server/auth/current';
import {
  updateEditionBasics,
  updateEditionBranding,
  updateEditionEmailSettings,
  updateSpaceOnlyRules,
  type brandingSchema,
  type editionBasicsSchema,
  type emailSettingsSchema,
  type spaceOnlyRulesSchema,
} from '@/server/services/editions';
import {
  createExhibitorType,
  createHall,
  deleteExhibitorType,
  deleteHall,
  moveExhibitorType,
  moveHall,
  renameHall,
  updateExhibitorType,
} from '@/server/services/show-setup';
import {
  addExhibitor,
  addExhibitorNote,
  createStand,
  deleteExhibitorNote,
  deleteStand,
  inviteExhibitorContact,
  searchCompanies,
  sendUnsentInvitations,
  setStandStatus,
  updateStand,
  type addExhibitorSchema,
  type standSchema,
} from '@/server/services/stands';
import { MAX_IMPORT_BYTES, planImport, readSpreadsheet, runImport, type ImportPlan } from '@/server/services/exhibitor-import';
import { updateCompany, type companySchema } from '@/server/services/companies';
import { invalid } from '@/server/errors';
import { copyPageFromLibrary, createPage, deletePage, movePage, savePageToLibrary, updatePage, type pageSchema } from '@/server/services/manual';
import { copyTaskFromLibrary, createTask, deleteTask, moveTask, saveTaskToLibrary, updateTask, type TaskInput } from '@/server/services/tasks';
import {
  extendDeadlineForStand,
  reopenForStand,
  reviewSubmission,
  submissionForStaff,
  type REVIEW_OUTCOMES,
} from '@/server/services/submissions';
import { parseLocalDateTime } from '@/lib/dates';

const refresh = (editionId: string) => revalidatePath(`/manage/${editionId}`, 'layout');
const id = (v: unknown) => String(v ?? '');

// Settings ------------------------------------------------------------------

export async function updateDetailsAction(editionId: string, input: z.input<typeof editionBasicsSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await updateEditionBasics(await requireActor(), id(editionId), input);
    refresh(editionId);
  }, 'Details saved.');
}

export async function updateBrandingAction(editionId: string, input: z.input<typeof brandingSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await updateEditionBranding(await requireActor(), id(editionId), input);
    refresh(editionId);
  }, 'Branding saved.');
}

export async function updateEmailSettingsAction(editionId: string, input: z.input<typeof emailSettingsSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await updateEditionEmailSettings(await requireActor(), id(editionId), input);
    refresh(editionId);
  }, 'Email settings saved.');
}

export async function updateSpaceOnlyRulesAction(editionId: string, input: z.input<typeof spaceOnlyRulesSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await updateSpaceOnlyRules(await requireActor(), id(editionId), input);
    refresh(editionId);
  }, 'Space-only rules saved.');
}

// Exhibitor types and halls --------------------------------------------------

export async function createTypeAction(editionId: string, input: { name: string; description?: string; isSpaceOnly: boolean }): Promise<ActionResult> {
  return runAction(async () => {
    await createExhibitorType(await requireActor(), id(editionId), input);
    refresh(editionId);
  }, 'Stand type added.');
}

export async function updateTypeAction(editionId: string, typeId: string, input: { name: string; description?: string; isSpaceOnly: boolean }): Promise<ActionResult> {
  return runAction(async () => {
    await updateExhibitorType(await requireActor(), id(typeId), input);
    refresh(editionId);
  }, 'Stand type saved.');
}

export async function deleteTypeAction(editionId: string, typeId: string): Promise<ActionResult> {
  return runAction(async () => {
    await deleteExhibitorType(await requireActor(), id(typeId));
    refresh(editionId);
  }, 'Stand type deleted.');
}

export async function moveTypeAction(editionId: string, typeId: string, direction: 'up' | 'down'): Promise<ActionResult> {
  return runAction(async () => {
    await moveExhibitorType(await requireActor(), id(typeId), direction === 'up' ? 'up' : 'down');
    refresh(editionId);
  });
}

export async function createHallAction(editionId: string, name: string): Promise<ActionResult> {
  return runAction(async () => {
    await createHall(await requireActor(), id(editionId), String(name ?? ''));
    refresh(editionId);
  }, 'Hall added.');
}

export async function renameHallAction(editionId: string, hallId: string, name: string): Promise<ActionResult> {
  return runAction(async () => {
    await renameHall(await requireActor(), id(hallId), String(name ?? ''));
    refresh(editionId);
  }, 'Hall renamed.');
}

export async function deleteHallAction(editionId: string, hallId: string): Promise<ActionResult> {
  return runAction(async () => {
    await deleteHall(await requireActor(), id(hallId));
    refresh(editionId);
  }, 'Hall deleted.');
}

export async function moveHallAction(editionId: string, hallId: string, direction: 'up' | 'down'): Promise<ActionResult> {
  return runAction(async () => {
    await moveHall(await requireActor(), id(hallId), direction === 'up' ? 'up' : 'down');
    refresh(editionId);
  });
}

// Exhibitors and stands --------------------------------------------------------

export async function addExhibitorAction(editionId: string, input: z.input<typeof addExhibitorSchema>): Promise<ActionResult<{ companyId: string }>> {
  return runAction(async () => {
    const r = await addExhibitor(await requireActor(), id(editionId), input);
    refresh(editionId);
    return { companyId: r.companyId };
  }, 'Exhibitor added.');
}

export async function searchCompaniesAction(editionId: string, q: string): Promise<ActionResult<{ id: string; name: string; website: string | null; city: string | null }[]>> {
  return runAction(async () => searchCompanies(await requireActor(), id(editionId), String(q ?? '').slice(0, 100)));
}

export async function createStandAction(editionId: string, input: z.input<typeof standSchema> & { companyId?: string | null }): Promise<ActionResult> {
  return runAction(async () => {
    await createStand(await requireActor(), id(editionId), input);
    refresh(editionId);
  }, 'Stand added.');
}

export async function updateStandAction(editionId: string, standId: string, input: z.input<typeof standSchema> & { companyId?: string | null }): Promise<ActionResult> {
  return runAction(async () => {
    await updateStand(await requireActor(), id(standId), input);
    refresh(editionId);
  }, 'Stand saved.');
}

export async function setStandStatusAction(editionId: string, standId: string, status: 'active' | 'cancelled'): Promise<ActionResult> {
  return runAction(async () => {
    await setStandStatus(await requireActor(), id(standId), status === 'cancelled' ? 'cancelled' : 'active');
    refresh(editionId);
  }, status === 'cancelled' ? 'Stand cancelled.' : 'Stand restored.');
}

export async function deleteStandAction(editionId: string, standId: string): Promise<ActionResult> {
  return runAction(async () => {
    await deleteStand(await requireActor(), id(standId));
    refresh(editionId);
  }, 'Stand deleted.');
}

export async function updateExhibitorCompanyAction(editionId: string, companyId: string, input: z.input<typeof companySchema>): Promise<ActionResult> {
  return runAction(async () => {
    await updateCompany(await requireActor(), id(companyId), input);
    refresh(editionId);
  }, 'Company details saved.');
}

export async function inviteContactAction(
  editionId: string,
  companyId: string,
  input: { email: string; role: 'main_contact' | 'colleague'; sendNow: boolean },
): Promise<ActionResult> {
  return runAction(async () => {
    await inviteExhibitorContact(await requireActor(), id(editionId), id(companyId), input);
    refresh(editionId);
  }, input.sendNow ? 'Invitation sent.' : 'Invitation saved. Send it when the show is ready.');
}

export async function sendUnsentInvitesAction(editionId: string): Promise<ActionResult<{ sent: number; skipped: number }>> {
  return runAction(async () => {
    const r = await sendUnsentInvitations(await requireActor(), id(editionId));
    refresh(editionId);
    return r;
  });
}

export async function addNoteAction(editionId: string, companyId: string, body: string): Promise<ActionResult> {
  return runAction(async () => {
    await addExhibitorNote(await requireActor(), id(editionId), id(companyId), String(body ?? ''));
    refresh(editionId);
  }, 'Note added.');
}

export async function deleteNoteAction(editionId: string, noteId: string): Promise<ActionResult> {
  return runAction(async () => {
    await deleteExhibitorNote(await requireActor(), id(noteId));
    refresh(editionId);
  }, 'Note deleted.');
}

// Import -----------------------------------------------------------------------

async function rowsFromForm(form: FormData) {
  const file = form.get('file');
  if (!(file instanceof File)) throw invalid('Choose a CSV or Excel file.');
  if (file.size > MAX_IMPORT_BYTES) throw invalid('That file is too big. Split it into files under 2 MB.');
  return readSpreadsheet(file.name, new Uint8Array(await file.arrayBuffer()));
}

function optionalId(v: FormDataEntryValue | null) {
  const s = typeof v === 'string' ? v : '';
  return /^[0-9a-f-]{36}$/i.test(s) ? s : null;
}

export async function previewImportAction(editionId: string, form: FormData): Promise<ActionResult<ImportPlan>> {
  return runAction(async () => {
    const actor = await requireActor();
    const rows = await rowsFromForm(form);
    return planImport(actor, id(editionId), rows, { defaultTypeId: optionalId(form.get('defaultTypeId')) });
  });
}

export async function runImportAction(editionId: string, form: FormData): Promise<ActionResult<{ summary: string }>> {
  return runAction(async () => {
    const actor = await requireActor();
    const rows = await rowsFromForm(form);
    const r = await runImport(actor, id(editionId), rows, {
      defaultTypeId: optionalId(form.get('defaultTypeId')),
      sendInvites: form.get('sendInvites') === 'true',
    });
    refresh(editionId);
    return {
      summary: `Imported ${r.created} new and ${r.updated} updated stands, ${r.newCompanies} new companies, and ${r.invitations} invitations ${r.invitationsSent ? 'sent' : 'saved to send later'}.${r.skipped.length ? ` ${r.skipped.length} rows with problems were skipped.` : ''}${r.notInvited ? ` ${r.notInvited} contacts could not be invited (for example your own address).` : ''}`,
    };
  });
}

// Manual -------------------------------------------------------------------------

export async function savePageAction(editionId: string, pageId: string | null, input: z.input<typeof pageSchema>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requireActor();
    let pageIdOut: string;
    if (pageId) {
      await updatePage(actor, id(pageId), input);
      pageIdOut = id(pageId);
    } else {
      pageIdOut = (await createPage(actor, id(editionId), input)).id;
    }
    refresh(editionId);
    return { id: pageIdOut };
  }, 'Page saved.');
}

export async function deletePageAction(editionId: string, pageId: string): Promise<ActionResult> {
  return runAction(async () => {
    await deletePage(await requireActor(), id(pageId));
    refresh(editionId);
  }, 'Page deleted.');
}

export async function movePageAction(editionId: string, pageId: string, direction: 'up' | 'down'): Promise<ActionResult> {
  return runAction(async () => {
    await movePage(await requireActor(), id(pageId), direction === 'up' ? 'up' : 'down');
    refresh(editionId);
  });
}

export async function copyPageFromLibraryAction(editionId: string, itemId: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const page = await copyPageFromLibrary(await requireActor(), id(editionId), id(itemId));
    refresh(editionId);
    return { id: page.id };
  }, 'Page copied from the library. Check it, then publish it.');
}

export async function savePageToLibraryAction(pageId: string): Promise<ActionResult> {
  return runAction(async () => {
    await savePageToLibrary(await requireActor(), id(pageId));
  }, 'Saved to the library.');
}

// Tasks ----------------------------------------------------------------------------

export async function saveTaskAction(editionId: string, taskId: string | null, input: TaskInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await requireActor();
    let out: string;
    if (taskId) {
      await updateTask(actor, id(taskId), input);
      out = id(taskId);
    } else {
      out = (await createTask(actor, id(editionId), input)).id;
    }
    refresh(editionId);
    return { id: out };
  }, 'Task saved.');
}

export async function deleteTaskAction(editionId: string, taskId: string): Promise<ActionResult> {
  return runAction(async () => {
    await deleteTask(await requireActor(), id(taskId));
    refresh(editionId);
  }, 'Task deleted.');
}

export async function moveTaskAction(editionId: string, taskId: string, direction: 'up' | 'down'): Promise<ActionResult> {
  return runAction(async () => {
    await moveTask(await requireActor(), id(taskId), direction === 'up' ? 'up' : 'down');
    refresh(editionId);
  });
}

export async function copyTaskFromLibraryAction(editionId: string, itemId: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const t = await copyTaskFromLibrary(await requireActor(), id(editionId), id(itemId));
    refresh(editionId);
    return { id: t.id };
  }, 'Task copied from the library. Check it, then publish it.');
}

export async function saveTaskToLibraryAction(taskId: string): Promise<ActionResult> {
  return runAction(async () => {
    await saveTaskToLibrary(await requireActor(), id(taskId));
  }, 'Saved to the library.');
}

export async function reviewSubmissionAction(
  editionId: string,
  taskId: string,
  standId: string,
  outcome: (typeof REVIEW_OUTCOMES)[number],
  note: string | null,
): Promise<ActionResult> {
  return runAction(async () => {
    await reviewSubmission(await requireActor(), id(taskId), id(standId), outcome, note);
    refresh(editionId);
  }, 'Decision saved.');
}

export async function reopenSubmissionAction(editionId: string, taskId: string, standId: string, until: string): Promise<ActionResult> {
  return runAction(async () => {
    const at = parseLocalDateTime(until);
    if (!at) throw invalid('Choose a date.');
    await reopenForStand(await requireActor(), id(taskId), id(standId), at);
    refresh(editionId);
  }, 'Reopened for this stand.');
}

export async function extendDeadlineAction(editionId: string, taskId: string, standId: string, at: string | null): Promise<ActionResult> {
  return runAction(async () => {
    const when = at ? parseLocalDateTime(at) : null;
    if (at && !when) throw invalid('Choose a date.');
    await extendDeadlineForStand(await requireActor(), id(taskId), id(standId), when);
    refresh(editionId);
  }, at ? 'Deadline extended for this stand.' : 'Deadline put back.');
}

export async function submissionDetailAction(taskId: string, standId: string) {
  return runAction(async () => {
    const d = await submissionForStaff(await requireActor(), id(taskId), id(standId));
    return {
      submission: d.submission
        ? {
            status: d.submission.status,
            data: d.submission.data,
            version: d.submission.version,
            submittedAt: d.submission.submittedAt?.toISOString() ?? null,
            reviewNote: d.submission.reviewNote,
            reopenedUntil: d.submission.reopenedUntil?.toISOString() ?? null,
            deadlineOverrideAt: d.submission.deadlineOverrideAt?.toISOString() ?? null,
          }
        : null,
      submitter: d.submitter,
      files: d.files,
    };
  });
}
