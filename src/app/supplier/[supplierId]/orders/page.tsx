import { Anchor, Group, Paper, ScrollArea, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { LinkTabs } from '@/components/ui/link-tabs';
import { DownloadButton } from '@/components/links';
import { FulfilmentSelect } from '@/components/fulfilment-select';
import { FULFILMENT_LABELS, supplierOrderShows, supplierOrders } from '@/server/services/orders';
import { ParamSelect } from '@/components/ui/list-controls';
import { dateTime, money } from '@/lib/format';
import { loadSupplier } from '../load';
import { OrderLineDetails } from '@/components/order-line-details';

export default async function SupplierOrdersPage({ params, searchParams }: PageProps<'/supplier/[supplierId]/orders'>) {
  const { supplierId } = await params;
  const sp = await searchParams;
  const { actor, editable } = await loadSupplier(supplierId);
  const view = sp.view === 'all' ? 'all' : 'open';
  const shows = await supplierOrderShows(actor, supplierId);
  const show = shows.find((s) => s.id === sp.show)?.id ?? null;
  const { lines } = await supplierOrders(actor, supplierId, { status: view, editionId: show });
  const base = `/supplier/${supplierId}/orders`;
  const keep = show ? `show=${show}` : '';
  return (
    <Stack>
      <PageHeader
        title="Orders"
        description="What exhibitors have ordered from you. Confirm each order, then mark it delivered once it is on the stand."
        actions={
          <DownloadButton href={`${base}/export${keep ? `?${keep}` : ''}`} variant="default">
            Download CSV
          </DownloadButton>
        }
      />
      {shows.length > 1 ? <ParamSelect param="show" label="Show" options={[{ value: 'all', label: 'All shows' }, ...shows.map((s) => ({ value: s.id, label: s.name }))]} /> : null}
      <LinkTabs
        value={view}
        tabs={[
          { value: 'open', label: 'To do', href: keep ? `${base}?${keep}` : base },
          { value: 'all', label: 'All orders', href: `${base}?view=all${keep ? `&${keep}` : ''}` },
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
                      {l.productCode ? (
                        <Text fz="xs" c="dimmed">
                          Code {l.productCode}
                        </Text>
                      ) : null}
                      {Object.keys(l.options).length ? (
                        <Text fz="xs" c="dimmed">
                          {Object.entries(l.options)
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(' · ')}
                        </Text>
                      ) : null}
                      <OrderLineDetails details={l.details} />
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
