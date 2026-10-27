'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Group } from '@mantine/core';
import { useAction } from '@/lib/use-action';
import { simulateCheckoutAction } from '@/app/portal/shop-actions';

export function SimulatorButtons({ orderId, slug, amount, practice = false }: { orderId: string; slug: string; amount: string; practice?: boolean }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<'pay' | 'cancel' | null>(null);
  const act = useAction(simulateCheckoutAction);
  const go = async (choice: 'pay' | 'cancel') => {
    setOutcome(choice);
    const r = await act.run(orderId, choice);
    if (r.ok) router.push(choice === 'pay' ? `/portal/${slug}/orders/${orderId}?checkout=done` : `/portal/${slug}/shop/basket?checkout=cancelled`);
  };
  return (
    <Group grow>
      <Button variant="default" loading={act.pending && outcome === 'cancel'} onClick={() => go('cancel')}>
        Cancel
      </Button>
      <Button color="green" loading={act.pending && outcome === 'pay'} onClick={() => go('pay')}>
        Pay {amount} ({practice ? 'practice' : 'test'})
      </Button>
    </Group>
  );
}
