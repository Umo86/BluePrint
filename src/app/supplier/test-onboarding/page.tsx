import { Alert, Stack, Text } from '@mantine/core';
import { notFound } from 'next/navigation';
import { AuthCard } from '@/components/auth-card';
import { requireActor } from '@/server/auth/current';
import { payments, SimulatedPayments } from '@/server/payments/provider';
import { FinishTestOnboarding } from './finish-button';

/** Stands in for Stripe's set-up pages on a local machine. It does not exist once Stripe is connected. */
export default async function TestOnboarding({ searchParams }: PageProps<'/supplier/test-onboarding'>) {
  await requireActor();
  if (!(payments() instanceof SimulatedPayments)) notFound();
  const sp = await searchParams;
  const account = typeof sp.account === 'string' && /^acct_sim[a-z0-9]{1,40}$/.test(sp.account) ? sp.account : null;
  if (!account) notFound();
  return (
    <AuthCard title="Test payout set-up" subtitle="Local payment simulator">
      <Stack>
        <Alert color="yellow">On the live site this is Stripe’s own set-up page, where the supplier gives their business and bank details to Stripe.</Alert>
        <Text fz="sm">Finishing here switches payouts on for this test supplier and sends any payouts that were waiting.</Text>
        <FinishTestOnboarding accountId={account} />
      </Stack>
    </AuthCard>
  );
}
