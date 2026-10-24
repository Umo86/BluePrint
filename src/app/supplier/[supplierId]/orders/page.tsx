import { Anchor, Group, Paper, ScrollArea, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { LinkTabs } from '@/components/ui/link-tabs';
import { DownloadButton } from '@/components/links';
import { FulfilmentSelect } from '@/components/fulfilment-select';
import { FULFILMENT_LABELS, supplierOrders } from '@/server/services/orders';
import { dateTime, money } from '@/lib/format';
import { loadSupplier } from '../load';

export default async function SupplierOrdersPage({ params, searchParams }: PageProps<'/supplier/[supplierId]/orders'>) {
  const { supplierId } = await params;
  const sp = await searchParams;
  const { actor, editable } = await loadSupplier(supplierId);
  const view = sp.view === 'all' ? 'all' : 'open';
  const { lines } = await supplierOrders(actor, supplierId, { status: view });
  const base = `/supplier/${supplierId}/orders`;
  return (
    <Stack>
      <PageHeader
        title="Orders"
        description="What exhibitors have ordered from you. Confirm each order, then mark it delivered once it is on the stand."
        actions={
          <DownloadButton href={`${base}/export`} variant="default">
            Download CSV
          </DownloadButton>
        }
      />
      <LinkTabs
        value={view}
        tabs={[
          { value: 'open', label: 'To do', href: base },
          { value: 'all', label: 'All orders', href: `${base}?view=all` },
        ]}
      />
      {lines.length ? (
        <Paper withBorder>
          <ScrollArea>
            <Table verticalSpacing="sm" miw={900}>
              <TableThead>
                <TableTr>
                  <TableTh>Order</TableTh>
                  <TableTh>Exhibitor</TableTh>
                  <TableTh>Item</TableTh>
                  <TableTh ta="right">Qty</TableTh>
                  <TableTh ta="right">Your payout</TableTh>
                  <TableTh>Status</TableTh>
                </TableTr>
              </TableThead>
              <TableTbody>
                {lines.map((l) => (
                  <TableTr key={l.id}>
                    <TableTd>
                      <Text fz="sm" fw={600}>
                        {l.order.number}
                      </Text>
                      <Text fz="xs" c="dimmed">
                        {dateTime(l.order.createdAt)}
                      </Text>
                      <Text fz="xs" c="dimmed">
                        {l.edition.name}
                      </Text>
                    </TableTd>
                    <TableTd>
                      <Text fz="sm">{l.companyName ?? '—'}</Text>
                      <Text fz="xs" c="dimmed">
                        Stand {l.stand.number}
                        {l.stand.hall ? `, hall ${l.stand.hall}` : ''}
                      </Text>
                      {l.contact ? (
                        <Text fz="xs">
                          {l.contact.name} ·{' '}
                          <Anchor href={`mailto:${l.contact.email}`} fz="xs">
                            {l.contact.email}
                          </Anchor>
                          {l.contact.phone ? ` · ${l.contact.phone}` : ''}
                        </Text>
                      ) : null}
                    </TableTd>
                    <TableTd>
                      <Text fz="sm" fw={500}>
                        {l.description}
                      </Text>
                      {Object.keys(l.options).length ? (
                        <Text fz="xs" c="dimmed">
                          {Object.entries(l.options)
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(' · ')}
                        </Text>
                      ) : null}
                      {Object.keys(l.details).length ? (
                        <Text fz="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap' }}>
                          {Object.values(l.details).map(String).join('\n')}
                        </Text>
                      ) : null}
                      {l.order.status === 'refunded' || l.refundedPence ? (
                        <Text fz="xs" c="grape">
                          Refunded{l.fulfilmentStatus === 'cancelled' ? ': do not supply' : ' in part'}
                        </Text>
                      ) : null}
                    </TableTd>
                    <TableTd ta="right">{l.quantity}</TableTd>
                    <TableTd ta="right">{money(l.payoutPence)}</TableTd>
                    <TableTd>
                      {editable && l.fulfilmentStatus !== 'cancelled' && l.order.status !== 'refunded' ? (
                        <FulfilmentSelect lineId={l.id} value={l.fulfilmentStatus} label={`${l.order.number} ${l.description}`} />
                      ) : (
                        <StatusBadge status={l.fulfilmentStatus} label={FULFILMENT_LABELS[l.fulfilmentStatus]} />
                      )}
                    </TableTd>
                  </TableTr>
                ))}
              </TableTbody>
            </Table>
          </ScrollArea>
        </Paper>
      ) : (
        <EmptyState title={view === 'open' ? 'Nothing to do' : 'No orders yet'} description="New orders appear here, and we email you as soon as one comes in." />
      )}
      <Group>
        <Text fz="xs" c="dimmed">
          Exhibitor contact details are shared with you only so you can deliver their order. Please do not use them for marketing.
        </Text>
      </Group>
    </Stack>
  );
}
