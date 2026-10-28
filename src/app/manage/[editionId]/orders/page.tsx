import { Alert, Group, Paper, SimpleGrid, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageNav, SearchFilter } from '@/components/ui/list-controls';
import { ButtonLink, DownloadButton, TextLink } from '@/components/links';
import { ORDER_FILTERS, ORDER_STATUS_LABELS, ordersForEdition } from '@/server/services/orders';
import { openBasketCount } from '@/server/services/baskets';
import { dateTime, money } from '@/lib/format';
import { loadEdition } from '../load';

const FILTER_LABELS: Record<(typeof ORDER_FILTERS)[number], string> = {
  all: 'All orders',
  pending_payment: 'Awaiting card payment',
  paid: 'Paid',
  invoiced: 'Invoiced, not yet paid',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
};

export default async function OrdersPage({ params, searchParams }: PageProps<'/manage/[editionId]/orders'>) {
  const { editionId } = await params;
  const sp = await searchParams;
  const { actor, edition } = await loadEdition(editionId, 'orders');
  const status = ORDER_FILTERS.find((f) => f === sp.filter) ?? 'all';
  const page = Number.parseInt(typeof sp.page === 'string' ? sp.page : '1', 10) || 1;
  const q = typeof sp.q === 'string' ? sp.q : '';
  const [result, basketCount] = await Promise.all([ordersForEdition(actor, edition.id, { status, q, page }), openBasketCount(actor, edition.id)]);
  const base = `/manage/${edition.id}/orders`;
  return (
    <Stack>
      <PageHeader
        title="Orders"
        description="Everything exhibitors have ordered from the shop, how they paid, and refunds."
        actions={
          <Group gap="xs">
            <ButtonLink href={`${base}/baskets`} variant="default">
              Open baskets{basketCount ? ` (${basketCount})` : ''}
            </ButtonLink>
            <ButtonLink href={`${base}/services`} variant="default">
              Services by stand
            </ButtonLink>
            <ButtonLink href={`${base}/commission`} variant="default">
              Commission and payouts
            </ButtonLink>
            <DownloadButton href={`${base}/export`} variant="default">
              Download CSV
            </DownloadButton>
          </Group>
        }
      />
      <SimpleGrid cols={{ base: 2, md: 4 }}>
        <StatCard label="Paid" value={money(result.summary.paidPence)} hint="After refunds" />
        <StatCard label="Invoiced, unpaid" value={money(result.summary.invoicedPence)} hint={result.summary.overdue ? `${result.summary.overdue} overdue` : 'None overdue'} color={result.summary.overdue ? 'red' : undefined} />
        <StatCard label="Awaiting card payment" value={result.summary.awaiting} hint="Released after an hour if unpaid" />
        <StatCard label="Payouts needing attention" value={result.transferProblems + result.manualUnsettled} hint={`${result.transferProblems} waiting or failed · ${result.manualUnsettled} to pay by hand`} color={result.transferProblems ? 'orange' : undefined} />
      </SimpleGrid>
      {result.transferProblems ? (
        <Alert color="orange">Some supplier payouts are waiting (usually for the supplier to finish Stripe set-up) or failed. Open the order to retry.</Alert>
      ) : null}
      <SearchFilter placeholder="Order number, company, stand or PO" filterOptions={ORDER_FILTERS.map((f) => ({ value: f, label: FILTER_LABELS[f] }))} filterLabel="Show" />
      <Paper withBorder>
        <Table verticalSpacing="sm" striped>
          <TableThead>
            <TableTr>
              <TableTh>Order</TableTh>
              <TableTh>Exhibitor</TableTh>
              <TableTh>Payment</TableTh>
              <TableTh ta="right">Total</TableTh>
              <TableTh>Status</TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {result.rows.map((o) => (
              <TableTr key={o.id}>
                <TableTd>
                  <TextLink href={`${base}/${o.id}`} fw={600} fz="sm">
                    {o.number}
                  </TextLink>
                  <Text fz="xs" c="dimmed">
                    {dateTime(o.createdAt, edition.timezone)}
                  </Text>
                </TableTd>
                <TableTd>
                  <Text fz="sm">{o.companyName ?? '—'}</Text>
                  <Text fz="xs" c="dimmed">
                    Stand {o.standNumber}
                    {o.poNumber ? ` · PO ${o.poNumber}` : ''}
                  </Text>
                </TableTd>
                <TableTd>
                  <Text fz="sm">{o.paymentMethod === 'card' ? 'Card' : 'Invoice'}</Text>
                  {o.paymentMethod === 'invoice' && o.status === 'invoiced' && o.dueAt ? (
                    <Text fz="xs" c={o.dueAt < new Date() ? 'red' : 'dimmed'}>
                      Due {dateTime(o.dueAt, edition.timezone)}
                    </Text>
                  ) : null}
                </TableTd>
                <TableTd ta="right">
                  <Text fz="sm" fw={600}>
                    {money(o.totalPence)}
                  </Text>
                  {o.refundedPence ? (
                    <Text fz="xs" c="grape">
                      {money(o.refundedPence)} refunded
                    </Text>
                  ) : null}
                </TableTd>
                <TableTd>
                  <StatusBadge status={o.status} label={ORDER_STATUS_LABELS[o.status]} />
                </TableTd>
              </TableTr>
            ))}
          </TableTbody>
        </Table>
        {!result.rows.length ? (
          <Text p="md" c="dimmed" fz="sm">
            No orders{q || status !== 'all' ? ' match' : ' yet'}.
          </Text>
        ) : null}
      </Paper>
      <PageNav total={result.total} page={result.page} pageSize={result.pageSize} />
    </Stack>
  );
}
