import { Alert, Group, Stack, Text } from '@mantine/core';
import { notFound } from 'next/navigation';
import { AuthCard } from '@/components/auth-card';
import { requireActor } from '@/server/auth/current';
import { simulatorOrder } from '@/server/services/shop';
import { AppError } from '@/server/errors';
import { money } from '@/lib/format';
import { SimulatorButtons } from './simulator-buttons';

/** Stands in for Stripe's payment page on a local machine. It does not exist once Stripe is connected. */
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
  const { order, edition } = data;
  return (
    <AuthCard title="Test payment" subtitle={`${edition.name} · order ${order.number}`}>
      <Stack>
        <Alert color="yellow">This is the local payment simulator. No real card is charged. On the live site, exhibitors pay on Stripe’s secure page instead.</Alert>
        <Group justify="space-between">
          <Text>Amount</Text>
          <Text fw={700} fz="xl">
            {money(order.totalPence)}
          </Text>
        </Group>
        {order.status === 'pending_payment' ? (
          <SimulatorButtons orderId={order.id} slug={edition.slug} amount={money(order.totalPence)} />
        ) : (
          <Text c="dimmed">This order is no longer waiting for payment.</Text>
        )}
      </Stack>
    </AuthCard>
  );
}
