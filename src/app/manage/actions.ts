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

export async function sendUnsentInvitesAction(editionId: string): Promise<ActionResult<{ sent: number }>> {
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
      summary: `Imported ${r.created} new and ${r.updated} updated stands, ${r.newCompanies} new companies, and ${r.invitations} invitations ${r.invitationsSent ? 'sent' : 'saved to send later'}.${r.skipped.length ? ` ${r.skipped.length} rows with problems were skipped.` : ''}`,
    };
  });
}
