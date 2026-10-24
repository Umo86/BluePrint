'use client';

import { Button } from '@mantine/core';
import { useRouter } from 'next/navigation';
import { useAction } from '@/lib/use-action';
import { cancelMyCheckoutAction } from '../../../shop-actions';

export function CancelCheckoutButton({ slug, orderId }: { slug: string; orderId: string }) {
  const router = useRouter();
  const act = useAction(cancelMyCheckoutAction, { onSuccess: () => router.push(`/portal/${slug}/shop/basket`) });
  return (
    <Button variant="default" loading={act.pending} onClick={() => act.run(slug, orderId)}>
      Cancel this payment
    </Button>
  );
}
