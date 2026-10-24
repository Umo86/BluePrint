import { Alert, Badge, Group, Paper, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, Title } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { supplierOverview } from '@/server/services/supplier-portal';
import { supplierPayouts } from '@/server/services/orders';
import { dateTime, money } from '@/lib/format';
import { loadSupplier } from '../load';
import { StripeButtons } from '../stripe-buttons';

const LABELS: Record<string, string> = { pending: 'Waiting', created: 'Sent', failed: 'Problem (we are on it)', reversed: 'Taken back', partially_reversed: 'Part taken back', manual: 'By bank transfer' };

export default async function SupplierPayoutsPage({ params, searchParams }: PageProps<'/supplier/[supplierId]/payouts'>) {
  const { supplierId } = await params;
  const sp = await searchParams;
  const { actor, editable } = await loadSupplier(supplierId);
  const [o, rows] = await Promise.all([supplierOverview(actor, supplierId), supplierPayouts(actor, supplierId)]);
  const s = o.supplier.stripe;
  return (
    <Stack>
      <PageHeader title="Payouts" description="Your share of each paid order. Card orders are paid to your bank through Stripe; orders paid on invoice are paid by Media10's finance team by bank transfer." />
      {sp.stripe === 'return' && !s.payoutsEnabled ? <Alert color="yellow">Thanks. If Stripe still needs anything it will say so; press “Check status” to see the latest.</Alert> : null}
      <Paper withBorder p="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={2} fz="md">
              Stripe payouts
            </Title>
            <Group gap="xs" mt={6}>
              {s.payoutsEnabled ? (
                <Badge color="green">Payouts on</Badge>
              ) : s.connected ? (
                <Badge color="yellow">Set-up not finished</Badge>
              ) : (
                <Badge color="gray">Not set up</Badge>
              )}
              {o.paymentsMode === 'simulator' ? (
                <Badge color="orange" variant="light">
                  Test mode
                </Badge>
              ) : null}
            </Group>
            <Text fz="sm" c="dimmed" mt={6} maw={560}>
              Stripe checks who you are and where to send your money. BluePrint never sees or stores your bank details.
            </Text>
          </div>
          {o.paymentsMode ? <StripeButtons supplierId={supplierId} connected={s.connected} ready={s.payoutsEnabled} editable={editable} /> : <Text fz="sm">Card payments are not switched on yet.</Text>}
        </Group>
      </Paper>
      <Paper withBorder>
        <Table verticalSpacing="sm">
          <TableThead>
            <TableTr>
              <TableTh>Order</TableTh>
              <TableTh>Show</TableTh>
              <TableTh ta="right">Amount</TableTh>
              <TableTh>Status</TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {rows.map((r) => (
              <TableTr key={r.id}>
                <TableTd>
                  <Text fz="sm" fw={600}>
                    {r.orderNumber}
                  </Text>
                  <Text fz="xs" c="dimmed">
                    {dateTime(r.createdAt)}
                  </Text>
                </TableTd>
                <TableTd>{r.editionName}</TableTd>
                <TableTd ta="right">
                  <Text fz="sm">{money(r.amountPence - r.reversedPence)}</Text>
                  {r.reversedPence ? (
                    <Text fz="xs" c="grape">
                      {money(r.reversedPence)} taken back for a refund
                    </Text>
                  ) : null}
                </TableTd>
                <TableTd>
                  <StatusBadge status={r.status === 'created' ? 'paid' : r.status === 'manual' ? (r.settledAt ? 'paid' : 'pending') : r.status} label={r.status === 'manual' && r.settledAt ? `Paid by bank transfer ${dateTime(r.settledAt)}` : LABELS[r.status]} />
                  {r.waitingReason ? (
                    <Text fz="xs" c="dimmed">
                      {r.waitingReason}
                    </Text>
                  ) : null}
                </TableTd>
              </TableTr>
            ))}
          </TableTbody>
        </Table>
        {!rows.length ? (
          <Text p="md" fz="sm" c="dimmed">
            No payouts yet.
          </Text>
        ) : null}
      </Paper>
    </Stack>
  );
}
