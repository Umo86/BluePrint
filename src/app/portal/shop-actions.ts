'use server';

import { revalidatePath } from 'next/cache';
import { runAction, type ActionResult } from '@/server/actions';
import { requireActor } from '@/server/auth/current';
import { addToBasket, cancelMyCheckout, checkout, removeBasketItem, simulateCheckout, updateBasketItem, type addToBasketSchema, type checkoutSchema } from '@/server/services/shop';
import type { z } from 'zod';

const id = (v: unknown) => String(v ?? '');
const slugOf = (v: unknown) => {
  const s = String(v ?? '');
  return /^[a-z0-9-]{1,80}$/.test(s) ? s : '';
};

export async function addToBasketAction(slug: string, standId: string, input: z.input<typeof addToBasketSchema>): Promise<ActionResult<{ count: number }>> {
  return runAction(async () => {
    const r = await addToBasket(await requireActor(), id(standId), input);
    revalidatePath(`/portal/${slugOf(slug)}`, 'layout');
    return r;
  }, 'Added to your basket.');
}

export async function updateBasketItemAction(slug: string, standId: string, itemId: string, quantity: number): Promise<ActionResult> {
  return runAction(async () => {
    await updateBasketItem(await requireActor(), id(standId), id(itemId), Number(quantity));
    revalidatePath(`/portal/${slugOf(slug)}`, 'layout');
  });
}

export async function removeBasketItemAction(slug: string, standId: string, itemId: string): Promise<ActionResult> {
  return runAction(async () => {
    await removeBasketItem(await requireActor(), id(standId), id(itemId));
    revalidatePath(`/portal/${slugOf(slug)}`, 'layout');
  }, 'Removed.');
}

/** Places the order. Card orders come back with the payment page to go to; invoice orders are done. */
export async function checkoutAction(slug: string, standId: string, input: z.input<typeof checkoutSchema>): Promise<ActionResult<{ orderId: string; number: string; redirectUrl: string | null }>> {
  return runAction(async () => {
    const r = await checkout(await requireActor(), id(standId), input);
    revalidatePath(`/portal/${slugOf(slug)}`, 'layout');
    return r;
  });
}

export async function cancelMyCheckoutAction(slug: string, orderId: string): Promise<ActionResult> {
  return runAction(async () => {
    await cancelMyCheckout(await requireActor(), id(orderId));
    revalidatePath(`/portal/${slugOf(slug)}`, 'layout');
  }, 'Payment cancelled. Your basket is as you left it.');
}

/** Back from the payment page without paying: closes that checkout quietly (the page already says so). */
export async function closeCancelledCheckoutAction(slug: string, orderId: string): Promise<ActionResult> {
  return runAction(async () => {
    await cancelMyCheckout(await requireActor(), id(orderId));
    revalidatePath(`/portal/${slugOf(slug)}`, 'layout');
  });
}

/** Local payment simulator only (the service refuses when real Stripe is configured). */
export async function simulateCheckoutAction(orderId: string, outcome: 'pay' | 'cancel'): Promise<ActionResult> {
  return runAction(async () => {
    await simulateCheckout(await requireActor(), id(orderId), outcome === 'pay' ? 'pay' : 'cancel');
    revalidatePath('/portal', 'layout');
  });
}
