'use server';

import { revalidatePath } from 'next/cache';
import { runAction, type ActionResult } from '@/server/actions';
import { requireActor } from '@/server/auth/current';
import {
  createCategory,
  createProduct,
  deleteCategory,
  deleteProduct,
  moveCategory,
  moveProduct,
  setProductStatus,
  updateCategory,
  updateProduct,
  type CategoryInput,
  type ProductInput,
  type PRODUCT_DECISIONS,
} from '@/server/services/catalogue';
import { cancelOrder, markInvoicePaid, refundOrder, retryTransfer, setLineFulfilment, settleManualTransfer, type refundSchema } from '@/server/services/orders';
import { sendBasketReminderNow, updateBasketReminderSettings, type basketSettingsSchema } from '@/server/services/baskets';
import { isDemoEdition } from '@/server/demo/flags';
import type { z } from 'zod';

const id = (v: unknown) => String(v ?? '');
const dir = (v: unknown) => (v === 'up' ? 'up' : 'down');
const refresh = () => revalidatePath('/manage', 'layout');

export async function createCategoryAction(editionId: string, input: CategoryInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const c = await createCategory(await requireActor(), id(editionId), input);
    refresh();
    return { id: c.id };
  }, 'Category added.');
}

export async function updateCategoryAction(categoryId: string, input: CategoryInput): Promise<ActionResult> {
  return runAction(async () => {
    await updateCategory(await requireActor(), id(categoryId), input);
    refresh();
  }, 'Saved.');
}

export async function deleteCategoryAction(categoryId: string): Promise<ActionResult> {
  return runAction(async () => {
    await deleteCategory(await requireActor(), id(categoryId));
    refresh();
  }, 'Category deleted.');
}

export async function moveCategoryAction(categoryId: string, direction: 'up' | 'down'): Promise<ActionResult> {
  return runAction(async () => {
    await moveCategory(await requireActor(), id(categoryId), dir(direction));
    refresh();
  });
}

export async function createProductAction(editionId: string, input: ProductInput, draft: boolean): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const p = await createProduct(await requireActor(), id(editionId), input, { draft: draft === true });
    refresh();
    return { id: p.id };
  }, draft ? 'Saved as a draft.' : 'Product added. It is on sale now.');
}

export async function updateProductAction(productId: string, input: ProductInput): Promise<ActionResult> {
  return runAction(async () => {
    await updateProduct(await requireActor(), id(productId), input);
    refresh();
  }, 'Saved.');
}

export async function setProductStatusAction(productId: string, status: (typeof PRODUCT_DECISIONS)[number], reason?: string | null): Promise<ActionResult> {
  return runAction(async () => {
    await setProductStatus(await requireActor(), id(productId), status, reason ?? null);
    refresh();
  }, status === 'approved' ? 'Approved. It is on sale now.' : status === 'rejected' ? 'Sent back to the supplier.' : status === 'archived' ? 'Taken off sale.' : 'Saved.');
}

export async function deleteProductAction(productId: string): Promise<ActionResult> {
  return runAction(async () => {
    await deleteProduct(await requireActor(), id(productId));
    refresh();
  }, 'Product deleted.');
}

export async function moveProductAction(productId: string, direction: 'up' | 'down'): Promise<ActionResult> {
  return runAction(async () => {
    await moveProduct(await requireActor(), id(productId), dir(direction));
    refresh();
  });
}

export async function refundOrderAction(orderId: string, input: z.input<typeof refundSchema>): Promise<ActionResult<{ creditNote: string | null }>> {
  return runAction(async () => {
    const r = await refundOrder(await requireActor(), id(orderId), input);
    refresh();
    return { creditNote: r.creditNote };
  }, 'Refund made and credit note issued.');
}

export async function cancelOrderAction(orderId: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    await cancelOrder(await requireActor(), id(orderId), String(reason ?? ''));
    refresh();
  }, 'Order cancelled.');
}

export async function markInvoicePaidAction(orderId: string, reference: string): Promise<ActionResult> {
  return runAction(async () => {
    await markInvoicePaid(await requireActor(), id(orderId), String(reference ?? ''));
    refresh();
  }, 'Marked as paid.');
}

export async function retryTransferAction(transferId: string): Promise<ActionResult<{ sent: number }>> {
  return runAction(async () => {
    const r = await retryTransfer(await requireActor(), id(transferId));
    revalidatePath('/', 'layout');
    return { sent: r.sent };
  });
}

export async function settleManualTransferAction(transferId: string, reference: string): Promise<ActionResult> {
  return runAction(async () => {
    await settleManualTransfer(await requireActor(), id(transferId), String(reference ?? ''));
    revalidatePath('/', 'layout');
  }, 'Recorded as paid.');
}

export async function setLineFulfilmentAction(lineId: string, status: 'received' | 'confirmed' | 'delivered'): Promise<ActionResult> {
  return runAction(async () => {
    await setLineFulfilment(await requireActor(), id(lineId), status);
    revalidatePath('/', 'layout');
  }, 'Updated.');
}

export async function sendBasketReminderAction(editionId: string, standId: string): Promise<ActionResult<{ emails: number }>> {
  const res = await runAction(async () => {
    const r = await sendBasketReminderNow(await requireActor(), id(editionId), id(standId));
    refresh();
    return r;
  });
  if (!res.ok || !res.data) return res;
  const { emails, recipients } = res.data;
  const message = emails
    ? `Reminder sent${recipients > 1 ? ` to ${recipients} people` : ''}.`
    : (await isDemoEdition(id(editionId)))
      ? 'Reminder kept in the sent emails. Demo shows never send email.'
      : 'Reminder recorded, but email sending is not set up yet, so it was not sent.';
  return { ...res, message };
}

export async function updateBasketRemindersAction(editionId: string, input: z.input<typeof basketSettingsSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await updateBasketReminderSettings(await requireActor(), id(editionId), input);
    refresh();
  }, 'Basket reminder settings saved.');
}
