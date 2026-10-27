import { Alert, Stack, Text } from '@mantine/core';
import { notFound } from 'next/navigation';
import { AuthCard } from '@/components/auth-card';
import { eq } from 'drizzle-orm';
import { requireActor } from '@/server/auth/current';
import { getDb } from '@/server/db/client';
import { suppliers } from '@/server/db/schema';
import { payments, paymentsForSupplier, SimulatedPayments } from '@/server/payments/provider';
import { FinishTestOnboarding } from './finish-button';

/**
 * Stands in for Stripe's set-up pages on a local machine, and for the demo suppliers on any site
 * (their payouts are practice ones). It does not exist for a real supplier once Stripe is connected.
 */
export default async function TestOnboarding({ searchParams }: PageProps<'/supplier/test-onboarding'>) {
  await requireActor();
  const sp = await searchParams;
  const account = typeof sp.account === 'string' && /^acct_sim[a-z0-9]{1,40}$/.test(sp.account) ? sp.account : null;
  if (!account) notFound();
  const db = await getDb();
  const [supplier] = await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.stripeAccountId, account)).limit(1);
  if (!supplier || !((await paymentsForSupplier(supplier.id)) instanceof SimulatedPayments)) notFound();
  const practice = !(payments() instanceof SimulatedPayments);
  return (
    <AuthCard title={practice ? 'Practice payout set-up' : 'Test payout set-up'} subtitle={practice ? 'Demo supplier' : 'Local payment simulator'}>
      <Stack>
        <Alert color="yellow">
          {practice
            ? 'This is a demo supplier, so this stands in for Stripe’s own set-up page. A real supplier gives their business and bank details to Stripe there.'
            : 'On the live site this is Stripe’s own set-up page, where the supplier gives their business and bank details to Stripe.'}
        </Alert>
        <Text fz="sm">Finishing here switches payouts on for this {practice ? 'demo' : 'test'} supplier and sends any payouts that were waiting.</Text>
        <FinishTestOnboarding accountId={account} />
      </Stack>
    </AuthCard>
  );
}
