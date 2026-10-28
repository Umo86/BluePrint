'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { runAction, type ActionResult } from '@/server/actions';
import { requireActor } from '@/server/auth/current';
import {
  cloneEdition,
  createEdition,
  createShow,
  deleteEdition,
  deleteShow,
  setShowArchived,
  updateEditionBasics,
  updateEditionCommercial,
  updateShow,
  type cloneSchema,
  type commercialSchema,
  type editionBasicsSchema,
} from '@/server/services/editions';
import { inviteStaff, removeStaff, setStaffAccess, updateStaffRole } from '@/server/services/staff';
import {
  adminUpdateUser,
  removeCompanyMembership,
  removeSupplierMembership,
  revokeUserSessions,
  setSuperAdmin,
  setUserStatus,
  setLibraryRight,
} from '@/server/services/users';
import { resetTwoFactor } from '@/server/auth/login';
import { createInvitation, resendInvitation, revokeInvitation } from '@/server/auth/invitations';
import { createCompany, setCompanyArchived, setCompanyInvoiceAllowed, setMemberAccess, updateCompany, removeMember } from '@/server/services/companies';
import { createSupplier, removeSupplierUser, setSupplierStatus, updateSupplier, updateSupplierCommission } from '@/server/services/suppliers';
import { adminRefreshSupplierStripe } from '@/server/services/supplier-portal';
import { processTransfers } from '@/server/services/orders';
import { isCronJob, runCronJob, type CronJob } from '@/server/cron';
import { invalid } from '@/server/errors';
import { createLibraryItem, deleteLibraryItem, updateLibraryItem, type LibraryKind } from '@/server/services/library';
import { updatePlatformSettings, type PlatformSettings } from '@/server/services/settings';
import { checkAssistantConnection, type ConnectionCheck } from '@/server/assistant/admin';
import { removeSuppression, retryFailedEmails } from '@/server/services/system';
import { anonymisePerson, eraseEmailAddress, findPersonRecords } from '@/server/services/gdpr';
import { removeDemoData } from '@/server/demo/remove';
import { resetDemoData } from '@/server/demo/data';
import { testLogins } from '@/server/test-logins';
import { audit } from '@/server/audit';
import { assertSuperAdmin } from '@/server/authz';
import type { z } from 'zod';
import type { EditionPermission, EditionRole } from '@/server/db/schema';

async function superAdmin() {
  const actor = await requireActor();
  assertSuperAdmin(actor);
  return actor;
}

// Shows and editions -------------------------------------------------------

export async function createShowAction(input: { name: string; description?: string }): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const show = await createShow(await superAdmin(), input);
    revalidatePath('/admin/shows');
    return { id: show.id };
  }, 'Show created.');
}

export async function updateShowAction(showId: string, input: { name: string; description?: string }): Promise<ActionResult> {
  return runAction(async () => {
    await updateShow(await superAdmin(), showId, input);
    revalidatePath('/admin/shows');
  }, 'Show saved.');
}

export async function archiveShowAction(showId: string, archived: boolean): Promise<ActionResult> {
  return runAction(async () => {
    await setShowArchived(await superAdmin(), showId, archived);
    revalidatePath('/admin/shows');
  }, archived ? 'Show archived.' : 'Show restored.');
}

export async function deleteShowAction(showId: string): Promise<ActionResult> {
  return runAction(async () => {
    await deleteShow(await superAdmin(), showId);
    revalidatePath('/admin/shows');
  }, 'Show deleted.');
}

export async function createEditionAction(showId: string, input: z.input<typeof editionBasicsSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const e = await createEdition(await superAdmin(), showId, input);
    redirect(`/admin/editions/${e.id}`);
  });
}

export async function updateEditionAction(editionId: string, input: z.input<typeof editionBasicsSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await updateEditionBasics(await superAdmin(), editionId, input);
    revalidatePath(`/admin/editions/${editionId}`);
  }, 'Edition saved.');
}

export async function updateCommercialAction(editionId: string, input: z.input<typeof commercialSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await updateEditionCommercial(await superAdmin(), editionId, input);
    revalidatePath(`/admin/editions/${editionId}`);
  }, 'Commercial settings saved.');
}

export async function cloneEditionAction(editionId: string, input: z.input<typeof cloneSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const e = await cloneEdition(await superAdmin(), editionId, input);
    redirect(`/admin/editions/${e.id}`);
  });
}

export async function deleteEditionAction(editionId: string, confirmName: string): Promise<ActionResult> {
  return runAction(async () => {
    await deleteEdition(await superAdmin(), editionId, confirmName);
    redirect('/admin/shows');
  });
}

export async function inviteStaffAction(
  editionId: string,
  email: string,
  role: EditionRole,
  permissions: EditionPermission[],
): Promise<ActionResult> {
  return runAction(async () => {
    await inviteStaff(await requireActor(), editionId, email, { role, permissions });
    revalidatePath(`/admin/editions/${editionId}`);
    revalidatePath(`/manage/${editionId}/settings/team`);
  }, 'Invitation sent.');
}

export async function updateStaffAction(editionId: string, userId: string, role: EditionRole, permissions: EditionPermission[]): Promise<ActionResult> {
  return runAction(async () => {
    await updateStaffRole(await requireActor(), editionId, userId, { role, permissions });
    revalidatePath(`/admin/editions/${editionId}`);
    revalidatePath(`/manage/${editionId}/settings/team`);
  }, 'Access updated.');
}

/** From the rights list: adds someone to a show team, changes what they can do, or (null) takes them off it. Quiet on success. */
export async function setStaffAccessAction(
  editionId: string,
  userId: string,
  access: { role: EditionRole; permissions: EditionPermission[] } | null,
): Promise<ActionResult> {
  return runAction(async () => {
    await setStaffAccess(await requireActor(), editionId, userId, access);
    revalidatePath(`/admin/editions/${editionId}`);
  });
}

export async function setLibraryRightAction(userId: string, value: boolean): Promise<ActionResult> {
  return runAction(async () => {
    await setLibraryRight(await superAdmin(), userId, value);
    revalidatePath(`/admin/users/${userId}`);
  }, value ? 'They can now add to the library.' : 'Library right taken away.');
}

export async function removeStaffAction(editionId: string, userId: string): Promise<ActionResult> {
  return runAction(async () => {
    await removeStaff(await requireActor(), editionId, userId);
    revalidatePath(`/admin/editions/${editionId}`);
    revalidatePath(`/manage/${editionId}/settings/team`);
  }, 'Removed from the team.');
}

export async function revokeInvitationAction(invitationId: string): Promise<ActionResult> {
  return runAction(async () => {
    await revokeInvitation(await requireActor(), invitationId);
    revalidatePath('/', 'layout');
  }, 'Invitation cancelled.');
}

export async function resendInvitationAction(invitationId: string): Promise<ActionResult> {
  return runAction(async () => {
    await resendInvitation(await requireActor(), invitationId);
    revalidatePath('/', 'layout');
  }, 'Invitation sent again.');
}

// Users --------------------------------------------------------------------

export async function inviteSuperAdminAction(email: string): Promise<ActionResult> {
  return runAction(async () => {
    await createInvitation(await superAdmin(), { kind: 'super_admin', email });
    revalidatePath('/admin/users');
  }, 'Invitation sent.');
}

export async function updateUserAction(userId: string, input: { name: string; email: string; phone?: string; jobTitle?: string }): Promise<ActionResult> {
  return runAction(async () => {
    await adminUpdateUser(await superAdmin(), userId, input);
    revalidatePath(`/admin/users/${userId}`);
  }, 'User saved.');
}

export async function setUserStatusAction(userId: string, status: 'active' | 'disabled'): Promise<ActionResult> {
  return runAction(async () => {
    await setUserStatus(await superAdmin(), userId, status);
    revalidatePath(`/admin/users/${userId}`);
  }, status === 'disabled' ? 'Account disabled and signed out everywhere.' : 'Account enabled.');
}

export async function setSuperAdminAction(userId: string, value: boolean): Promise<ActionResult> {
  return runAction(async () => {
    await setSuperAdmin(await superAdmin(), userId, value);
    revalidatePath(`/admin/users/${userId}`);
  }, value ? 'Super admin rights granted.' : 'Super admin rights removed.');
}

export async function resetTwoFactorAction(userId: string): Promise<ActionResult> {
  return runAction(async () => {
    await resetTwoFactor(await superAdmin(), userId);
    revalidatePath(`/admin/users/${userId}`);
  }, 'Two-factor reset. They will set it up again at their next sign-in.');
}

export async function revokeSessionsAction(userId: string): Promise<ActionResult> {
  return runAction(async () => {
    await revokeUserSessions(await superAdmin(), userId);
    revalidatePath(`/admin/users/${userId}`);
  }, 'Signed out everywhere.');
}

export async function removeMembershipAction(userId: string, companyId: string): Promise<ActionResult> {
  return runAction(async () => {
    await removeCompanyMembership(await superAdmin(), userId, companyId);
    revalidatePath(`/admin/users/${userId}`);
  }, 'Removed from the company.');
}

export async function removeSupplierMembershipAction(userId: string, supplierId: string): Promise<ActionResult> {
  return runAction(async () => {
    await removeSupplierMembership(await superAdmin(), userId, supplierId);
    revalidatePath(`/admin/users/${userId}`);
  }, 'Removed from the supplier.');
}

export async function anonymiseUserAction(userId: string): Promise<ActionResult> {
  return runAction(async () => {
    await anonymisePerson(await superAdmin(), userId);
    revalidatePath('/admin/users');
    redirect('/admin/users');
  });
}

// Companies ----------------------------------------------------------------

type CompanyInput = Parameters<typeof updateCompany>[2];

export async function createCompanyAction(input: CompanyInput): Promise<ActionResult> {
  return runAction(async () => {
    const c = await createCompany(await superAdmin(), input);
    redirect(`/admin/companies/${c.id}`);
  });
}

export async function updateCompanyAction(companyId: string, input: CompanyInput): Promise<ActionResult> {
  return runAction(async () => {
    await updateCompany(await requireActor(), companyId, input);
    revalidatePath(`/admin/companies/${companyId}`);
  }, 'Company saved.');
}

export async function setInvoiceAllowedAction(companyId: string, allowed: boolean): Promise<ActionResult> {
  return runAction(async () => {
    await setCompanyInvoiceAllowed(await requireActor(), companyId, allowed);
    revalidatePath(`/admin/companies/${companyId}`);
  }, allowed ? 'Pay by invoice allowed.' : 'Pay by invoice turned off.');
}

export async function archiveCompanyAction(companyId: string, archived: boolean): Promise<ActionResult> {
  return runAction(async () => {
    await setCompanyArchived(await superAdmin(), companyId, archived);
    revalidatePath(`/admin/companies/${companyId}`);
  }, archived ? 'Company archived.' : 'Company restored.');
}

export async function setMemberAccessAction(companyId: string, userId: string, role: 'main_contact' | 'colleague', canPay: boolean): Promise<ActionResult> {
  return runAction(async () => {
    await setMemberAccess(await requireActor(), companyId, userId, { role, canPay });
    revalidatePath(`/admin/companies/${companyId}`);
  }, 'Access updated.');
}

export async function removeMemberAction(companyId: string, userId: string): Promise<ActionResult> {
  return runAction(async () => {
    await removeMember(await requireActor(), companyId, userId);
    revalidatePath(`/admin/companies/${companyId}`);
  }, 'Removed.');
}

// Suppliers ----------------------------------------------------------------

export async function createSupplierAction(input: { name: string; email: string; phone?: string; website?: string }): Promise<ActionResult> {
  return runAction(async () => {
    const s = await createSupplier(await requireActor(), input);
    redirect(`/admin/suppliers/${s.id}`);
  });
}

export async function updateSupplierAction(supplierId: string, input: { name: string; email: string; phone?: string; website?: string }): Promise<ActionResult> {
  return runAction(async () => {
    await updateSupplier(await requireActor(), supplierId, input);
    revalidatePath(`/admin/suppliers/${supplierId}`);
  }, 'Supplier saved.');
}

export async function updateSupplierCommissionAction(supplierId: string, type: 'percent' | 'fixed' | null, value: number | null, vatRegistered?: boolean): Promise<ActionResult> {
  return runAction(async () => {
    await updateSupplierCommission(await superAdmin(), supplierId, { commissionType: type, commissionValue: value, vatRegistered: typeof vatRegistered === 'boolean' ? vatRegistered : undefined });
    revalidatePath(`/admin/suppliers/${supplierId}`);
  }, 'Commission and VAT saved.');
}

export async function runCronJobAction(job: string): Promise<ActionResult<Record<string, unknown>>> {
  return runAction(async () => {
    const actor = await superAdmin();
    if (!isCronJob(String(job))) throw invalid('Unknown job.');
    const result = await runCronJob(job as CronJob);
    await audit(actor, 'cron.run_manually', { details: { job } });
    revalidatePath('/admin/system');
    return result;
  }, 'Done.');
}

export async function refreshSupplierStripeAction(supplierId: string): Promise<ActionResult> {
  return runAction(async () => {
    await superAdmin();
    await adminRefreshSupplierStripe(String(supplierId));
    revalidatePath(`/admin/suppliers/${supplierId}`);
  }, 'Checked with Stripe.');
}

export async function retryAllTransfersAction(): Promise<ActionResult<{ attempted: number; sent: number }>> {
  return runAction(async () => {
    const actor = await superAdmin();
    const r = await processTransfers({ includeFailed: true });
    await audit(actor, 'shop.transfers_retried', { details: r });
    revalidatePath('/admin/payments');
    return r;
  });
}

export async function setSupplierStatusAction(supplierId: string, status: 'active' | 'disabled'): Promise<ActionResult> {
  return runAction(async () => {
    await setSupplierStatus(await superAdmin(), supplierId, status);
    revalidatePath(`/admin/suppliers/${supplierId}`);
  }, status === 'disabled' ? 'Supplier disabled.' : 'Supplier enabled.');
}

export async function inviteSupplierUserAction(supplierId: string, email: string): Promise<ActionResult> {
  return runAction(async () => {
    await createInvitation(await requireActor(), { kind: 'supplier', email, supplierId });
    revalidatePath(`/admin/suppliers/${supplierId}`);
  }, 'Invitation sent.');
}

export async function removeSupplierUserAction(supplierId: string, userId: string): Promise<ActionResult> {
  return runAction(async () => {
    await removeSupplierUser(await superAdmin(), supplierId, userId);
    revalidatePath(`/admin/suppliers/${supplierId}`);
  }, 'Removed.');
}

// Library, settings, system -----------------------------------------------

export async function saveLibraryItemAction(
  id: string | null,
  input: { kind: LibraryKind; name: string; description?: string; data: Record<string, unknown> },
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await superAdmin();
    const row = id ? await updateLibraryItem(actor, id, input) : await createLibraryItem(actor, input);
    revalidatePath('/admin/library');
    return { id: row.id };
  }, 'Saved to the library.');
}

export async function deleteLibraryItemAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await deleteLibraryItem(await superAdmin(), id);
    revalidatePath('/admin/library');
  }, 'Deleted.');
}

export async function updateSettingsAction(patch: Partial<PlatformSettings>): Promise<ActionResult> {
  return runAction(async () => {
    await updatePlatformSettings(await superAdmin(), patch);
    revalidatePath('/admin/settings');
    revalidatePath('/admin/assistant');
  }, 'Settings saved.');
}

export async function checkAssistantConnectionAction(): Promise<ActionResult<ConnectionCheck>> {
  return runAction(async () => checkAssistantConnection(await superAdmin()));
}

export async function retryEmailsAction(): Promise<ActionResult<{ attempted: number; sent: number }>> {
  return runAction(async () => {
    const r = await retryFailedEmails(await superAdmin());
    revalidatePath('/admin/system');
    return r;
  });
}

export async function removeSuppressionAction(email: string): Promise<ActionResult> {
  return runAction(async () => {
    await removeSuppression(await superAdmin(), email);
    revalidatePath('/admin/system');
  }, 'Address can receive email again.');
}

// Privacy ------------------------------------------------------------------

export type PersonLookup = {
  email: string;
  user: { id: string; name: string; createdAt: string; anonymised: boolean } | null;
  counts: Record<string, number>;
};

export async function lookupPersonAction(email: string): Promise<ActionResult<PersonLookup>> {
  return runAction(async () => {
    const actor = await superAdmin();
    const r = await findPersonRecords(actor, String(email ?? '').slice(0, 254));
    await audit(actor, 'gdpr.lookup', { entityType: 'user', entityId: r.user?.id ?? null });
    return {
      email: r.email,
      user: r.user
        ? { id: r.user.id, name: r.user.name, createdAt: r.user.createdAt.toLocaleDateString('en-GB'), anonymised: Boolean(r.user.anonymisedAt) }
        : null,
      counts: r.counts,
    };
  });
}

export async function eraseAddressAction(email: string): Promise<ActionResult> {
  return runAction(async () => {
    await eraseEmailAddress(await superAdmin(), String(email ?? ''));
  }, 'Address erased.');
}

// Demo data ---------------------------------------------------------------------

export async function removeDemoDataAction(confirmation: string): Promise<ActionResult<Record<string, number>>> {
  return runAction(async () => {
    const counts = await removeDemoData(await superAdmin(), typeof confirmation === 'string' ? confirmation : '');
    revalidatePath('/', 'layout');
    return counts;
  }, 'The demo data has been removed.');
}

export async function resetDemoDataAction(): Promise<ActionResult> {
  return runAction(async () => {
    await resetDemoData(await superAdmin(), testLogins());
    revalidatePath('/', 'layout');
  }, 'Fresh demo data has been added.');
}
