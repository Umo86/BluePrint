import { Alert, Badge, Code, Group, Paper, SimpleGrid, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, Title } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { StatusBadge } from '@/components/ui/status-badge';
import { ActionButton } from '@/components/action-button';
import { TextLink } from '@/components/links';
import { requireSuperAdmin } from '@/server/auth/current';
import { paymentsHealth } from '@/server/services/orders';
import { dateTime, money } from '@/lib/format';
import { retryAllTransfersAction } from '../actions';
import { RetryTransferButton, SettleTransferButton } from '@/app/manage/[editionId]/orders/[orderId]/order-controls';

const MODE: Record<string, { label: string; color: string; hint: string }> = {
  stripe_live: { label: 'Stripe (live)', color: 'green', hint: 'Real card payments and payouts.' },
  stripe_test: { label: 'Stripe (test mode)', color: 'yellow', hint: 'Test cards only. Switch to live keys before opening the shop.' },
  simulator: { label: 'Local simulator', color: 'orange', hint: 'No Stripe key: a local stand-in. Never used on the live site.' },
  off: { label: 'Off', color: 'gray', hint: 'Exhibitors can only order on invoice.' },
};

const TRANSFER_LABELS: Record<string, string> = { pending: 'Waiting', failed: 'Failed', manual: 'To pay by hand' };

export default async function PaymentsPage() {
  await requireSuperAdmin();
  const h = await paymentsHealth();
  const mode = MODE[h.mode];
  const waiting = h.attention.filter((t) => t.status !== 'manual');
  const manual = h.attention.filter((t) => t.status === 'manual');
  return (
    <Stack>
      <PageHeader
        title="Payments"
        description="Card payments, supplier payouts and Stripe’s connection to BluePrint, across every show."
        actions={
          waiting.length ? (
            <ActionButton action={retryAllTransfersAction} args={[]} variant="default">
              Retry waiting payouts
            </ActionButton>
          ) : null
        }
      />
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
        <StatCard label="Card payments" value={<Badge color={mode.color} size="lg">{mode.label}</Badge>} hint={mode.hint} />
        <StatCard
          label="Stripe webhook"
          value={h.mode.startsWith('stripe') ? (h.webhookConfigured ? 'Set up' : 'Missing') : '—'}
          hint={h.lastEvent ? `Last event ${dateTime(h.lastEvent.receivedAt)}` : 'No events received yet'}
          color={h.mode.startsWith('stripe') && !h.webhookConfigured ? 'red' : undefined}
        />
        <StatCard label="Payouts waiting or failed" value={waiting.length} color={waiting.some((t) => t.status === 'failed') ? 'red' : waiting.length ? 'orange' : undefined} hint="Usually a supplier who has not finished Stripe set-up" />
        <StatCard label="Payouts to make by hand" value={manual.length} hint={money(manual.reduce((a, t) => a + t.amountPence - t.reversedPence, 0))} />
      </SimpleGrid>
      {h.mode === 'off' || h.mode === 'simulator' ? (
        <Alert color="blue" title="Connecting Stripe">
          Set <Code>STRIPE_SECRET_KEY</Code> and <Code>STRIPE_WEBHOOK_SECRET</Code> in the hosting settings, and point a Stripe webhook at <Code>/api/stripe/webhook</Code> with the checkout, account and refund events listed in the deployment guide.
        </Alert>
      ) : null}
      {h.failedRefunds.length ? (
        <Alert color="red" title="Refunds that failed">
          <Stack gap={4}>
            {h.failedRefunds.map((r) => (
              <Text key={r.id} fz="sm">
                <TextLink href={`/manage/${r.editionId}/orders/${r.orderId}`}>{r.orderNumber}</TextLink>: {money(r.amountPence)} · {r.error}
              </Text>
            ))}
          </Stack>
        </Alert>
      ) : null}
      <Paper withBorder p="md">
        <Title order={2} fz="md" mb="sm">
          Payouts needing attention
        </Title>
        {h.attention.length ? (
          <Table verticalSpacing="sm">
            <TableThead>
              <TableTr>
                <TableTh>Order</TableTh>
                <TableTh>Supplier</TableTh>
                <TableTh ta="right">Amount</TableTh>
                <TableTh>Status</TableTh>
                <TableTh />
              </TableTr>
            </TableThead>
            <TableTbody>
              {h.attention.map((t) => (
                <TableTr key={t.id}>
                  <TableTd>
                    <TextLink href={`/manage/${t.editionId}/orders/${t.orderId}`} fz="sm" fw={600}>
                      {t.orderNumber}
                    </TextLink>
                    <Text fz="xs" c="dimmed">
                      {t.editionName}
                    </Text>
                  </TableTd>
                  <TableTd>{t.supplierName}</TableTd>
                  <TableTd ta="right">{money(t.amountPence - t.reversedPence)}</TableTd>
                  <TableTd>
                    <StatusBadge status={t.status === 'manual' ? 'pending' : t.status} label={TRANSFER_LABELS[t.status] ?? t.status} />
                    {t.error ? (
                      <Text fz="xs" c={t.status === 'failed' ? 'red' : 'dimmed'}>
                        {t.error}
                      </Text>
                    ) : null}
                  </TableTd>
                  <TableTd>
                    <Group justify="flex-end">{t.status === 'manual' ? <SettleTransferButton transferId={t.id} /> : <RetryTransferButton transferId={t.id} />}</Group>
                  </TableTd>
                </TableTr>
              ))}
            </TableTbody>
          </Table>
        ) : (
          <Text fz="sm" c="dimmed">
            Nothing needs attention.
          </Text>
        )}
      </Paper>
      {h.failedEvents.length ? (
        <Paper withBorder p="md">
          <Title order={2} fz="md" mb="sm">
            Stripe events that failed
          </Title>
          <Text fz="sm" c="dimmed" mb="sm">
            Stripe retries these automatically for up to three days. Once one succeeds it disappears from this list.
          </Text>
          <Table>
            <TableTbody>
              {h.failedEvents.map((e) => (
                <TableTr key={e.id}>
                  <TableTd>{dateTime(e.receivedAt)}</TableTd>
                  <TableTd>
                    <Code>{e.type}</Code>
                  </TableTd>
                  <TableTd>
                    <Text fz="xs" c="red">
                      {e.error}
                    </Text>
                  </TableTd>
                </TableTr>
              ))}
            </TableTbody>
          </Table>
        </Paper>
      ) : null}
    </Stack>
  );
}
