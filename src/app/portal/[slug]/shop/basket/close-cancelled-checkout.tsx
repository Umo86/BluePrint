'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAction } from '@/lib/use-action';
import { closeCancelledCheckoutAction } from '../../../shop-actions';

/**
 * Back from the payment page without paying: cancels that checkout straight away, so no "awaiting
 * payment" order is left behind. If it was paid after all, nothing changes.
 */
export function CloseCancelledCheckout({ slug, orderId }: { slug: string; orderId: string }) {
  const router = useRouter();
  const done = useRef(false);
  const cancel = useAction(closeCancelledCheckoutAction, { notifyErrors: false, onSuccess: () => router.refresh() });
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void cancel.run(slug, orderId);
  }, [cancel, slug, orderId]);
  return null;
}
