'use client';

import { useState } from 'react';
import { Button, Group } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useAction } from '@/lib/use-action';
import { isAllowedPaymentRedirect } from '@/lib/safe-redirect';
import { refreshStripeStatusAction, startStripeOnboardingAction, stripeDashboardAction } from '../actions';

/** Set up (or continue setting up) Stripe payouts, check the status, or open the Stripe dashboard. */
export function StripeButtons({ supplierId, connected, ready, editable }: { supplierId: string; connected: boolean; ready: boolean; editable: boolean }) {
  const [leaving, setLeaving] = useState(false);
  const go = (url: string | null | undefined) => {
    if (!isAllowedPaymentRedirect(url)) {
      notifications.show({ color: 'red', message: 'Stripe did not return a page to open. Please try again.' });
      return;
    }
    setLeaving(true);
    window.location.assign(url);
  };
  const start = useAction(startStripeOnboardingAction, { onSuccess: (d) => go(d?.url) });
  const refresh = useAction(refreshStripeStatusAction, {
    onSuccess: (d) => notifications.show({ color: d?.payoutsEnabled ? 'green' : 'yellow', message: d?.payoutsEnabled ? 'Payouts are switched on.' : 'Stripe still needs some details from you.' }),
  });
  const dash = useAction(stripeDashboardAction, { onSuccess: (d) => (d?.url ? go(d.url) : notifications.show({ color: 'yellow', message: 'The Stripe dashboard is not available yet.' })) });
  return (
    <Group gap="xs">
      {!ready && editable ? (
        <Button loading={start.pending || leaving} onClick={() => start.run(supplierId)}>
          {connected ? 'Continue Stripe set-up' : 'Set up payouts with Stripe'}
        </Button>
      ) : null}
      {connected ? (
        <Button variant="default" loading={refresh.pending} onClick={() => refresh.run(supplierId)}>
          Check status
        </Button>
      ) : null}
      {ready ? (
        <Button variant="default" loading={dash.pending} onClick={() => dash.run(supplierId)}>
          Open Stripe dashboard
        </Button>
      ) : null}
    </Group>
  );
}
