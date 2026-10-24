'use server';

import { revalidatePath } from 'next/cache';
import { runAction, type ActionResult } from '@/server/actions';
import { requireActor } from '@/server/auth/current';
import { createSupplierProduct, submitSupplierProduct, updateSupplierProduct, withdrawSupplierProduct, type SupplierProductInput } from '@/server/services/catalogue';
import { completeSimulatedOnboarding, refreshStripeStatus, startStripeOnboarding, stripeDashboardLink } from '@/server/services/supplier-portal';
import { updateSupplier, type supplierSchema } from '@/server/services/suppliers';
import type { z } from 'zod';

const id = (v: unknown) => String(v ?? '');
const refresh = () => revalidatePath('/supplier', 'layout');

export async function createSupplierProductAction(supplierId: string, input: SupplierProductInput, submit: boolean): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const p = await createSupplierProduct(await requireActor(), id(supplierId), input, { submit: submit === true });
    refresh();
    return { id: p.id };
  }, submit ? 'Sent to the show team for approval.' : 'Saved as a draft.');
}

export async function updateSupplierProductAction(supplierId: string, productId: string, input: SupplierProductInput, submit: boolean): Promise<ActionResult<{ status: string }>> {
  return runAction(async () => {
    const r = await updateSupplierProduct(await requireActor(), id(supplierId), id(productId), input, { submit: submit === true });
    refresh();
    return r;
  }, 'Saved.');
}

export async function submitSupplierProductAction(supplierId: string, productId: string): Promise<ActionResult> {
  return runAction(async () => {
    await submitSupplierProduct(await requireActor(), id(supplierId), id(productId));
    refresh();
  }, 'Sent to the show team for approval.');
}

export async function withdrawSupplierProductAction(supplierId: string, productId: string): Promise<ActionResult> {
  return runAction(async () => {
    await withdrawSupplierProduct(await requireActor(), id(supplierId), id(productId));
    refresh();
  }, 'Product withdrawn.');
}

/** Returns the Stripe page to continue set-up on (or the local simulator page). */
export async function startStripeOnboardingAction(supplierId: string): Promise<ActionResult<{ url: string }>> {
  return runAction(async () => ({ url: await startStripeOnboarding(await requireActor(), id(supplierId)) }));
}

export async function refreshStripeStatusAction(supplierId: string): Promise<ActionResult<{ payoutsEnabled: boolean }>> {
  return runAction(async () => {
    const r = await refreshStripeStatus(await requireActor(), id(supplierId));
    refresh();
    return r;
  });
}

export async function stripeDashboardAction(supplierId: string): Promise<ActionResult<{ url: string | null }>> {
  return runAction(async () => ({ url: await stripeDashboardLink(await requireActor(), id(supplierId)) }));
}

export async function completeSimulatedOnboardingAction(accountId: string): Promise<ActionResult<{ supplierId: string }>> {
  return runAction(async () => {
    const supplierId = await completeSimulatedOnboarding(await requireActor(), id(accountId));
    refresh();
    return { supplierId };
  }, 'Test payouts set up.');
}

export async function updateSupplierDetailsAction(supplierId: string, input: z.input<typeof supplierSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await updateSupplier(await requireActor(), id(supplierId), input);
    refresh();
  }, 'Saved.');
}
