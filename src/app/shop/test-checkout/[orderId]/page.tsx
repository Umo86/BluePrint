import { Alert, Group, Stack, Text } from '@mantine/core';
import { notFound } from 'next/navigation';
import { AuthCard } from '@/components/auth-card';
import { requireActor } from '@/server/auth/current';
import { simulatorOrder } from '@/server/services/shop';
import { AppError } from '@/server/errors';
import { money } from '@/lib/format';
import { SimulatorButtons } from './simulator-buttons';

/**
 * Stands in for Stripe's payment page on a local machine, and for the demo shows on any site (they
 * never take real money). It does not exist for a real show once Stripe is connected.
 */
export default async function TestCheckout({ params }: PageProps<'/shop/test-checkout/[orderId]'>) {
  const { orderId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) notFound();
  const actor = await requireActor();
  let data: Awaited<ReturnType<typeof simulatorOrder>>;
  try {
    data = await simulatorOrder(actor, orderId);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
  const { order, edition, practice } = data;
  return (
    <AuthCard title={practice ? 'Practice payment' : 'Test payment'} subtitle={`${edition.name} · order ${order.number}`}>
      <Stack>
        <Alert color="yellow">
          {practice
            ? 'This is a demo show, so this is a practice payment: no card is charged and no money moves. In a real show, exhibitors pay on Stripe’s secure page instead.'
            : 'This is the local payment simulator. No real card is charged. On the live site, exhibitors pay on Stripe’s secure page instead.'}
        </Alert>
        <Group justify="space-between">
          <Text>Amount</Text>
          <Text fw={700} fz="xl">
            {money(order.totalPence)}
          </Text>
        </Group>
        {order.status === 'pending_payment' ? (
          <SimulatorButtons orderId={order.id} slug={edition.slug} amount={money(order.totalPence)} practice={practice} />
        ) : (
          <Text c="dimmed">This order is no longer waiting for payment.</Text>
        )}
      </Stack>
    </AuthCard>
  );
}
