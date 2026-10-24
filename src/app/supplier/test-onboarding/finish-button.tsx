'use client';

import { Button } from '@mantine/core';
import { useRouter } from 'next/navigation';
import { useAction } from '@/lib/use-action';
import { completeSimulatedOnboardingAction } from '../actions';

export function FinishTestOnboarding({ accountId }: { accountId: string }) {
  const router = useRouter();
  const act = useAction(completeSimulatedOnboardingAction, { onSuccess: (d) => d && router.push(`/supplier/${d.supplierId}/payouts?stripe=return`) });
  return (
    <Button color="green" loading={act.pending} onClick={() => act.run(accountId)}>
      Finish test set-up
    </Button>
  );
}
