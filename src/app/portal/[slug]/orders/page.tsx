import { Paper, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { ButtonLink, TextLink } from '@/components/links';
import { ORDER_STATUS_LABELS, ordersForStand } from '@/server/services/orders';
import { dateTime, money, plural } from '@/lib/format';
import { loadPortal } from '../load';

export default async function MyOrders({ params }: PageProps<'/portal/[slug]/orders'>) {
  const { slug } = await params;
  const ctx = await loadPortal(slug);
  const rows = await ordersForStand(ctx.actor, ctx.stand.id);
  const base = `/portal/${ctx.edition.slug}`;
  return (
    <Stack>
      <PageHeader title="Your orders" description={`Orders for stand ${ctx.stand.number}, with invoices and credit notes.`} actions={<ButtonLink href={`${base}/shop`}>Order services</ButtonLink>} />
      {rows.length ? (
        <Paper withBorder>
          <Table verticalSpacing="sm">
            <TableThead>
              <TableTr>
                <TableTh>Order</TableTh>
                <TableTh>Items</TableTh>
                <TableTh ta="right">Total</TableTh>
                <TableTh>Status</TableTh>
              </TableTr>
            </TableThead>
            <TableTbody>
              {rows.map((o) => (
                <TableTr key={o.id}>
                  <TableTd>
                    <TextLink href={`${base}/orders/${o.id}`} fw={600} fz="sm">
                      {o.number}
                    </TextLink>
                    <Text fz="xs" c="dimmed">
                      {dateTime(o.createdAt, ctx.edition.timezone)}
                    </Text>
                  </TableTd>
                  <TableTd>
                    <Text fz="sm">{plural(o.lineCount, 'item')}</Text>
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
        </Paper>
      ) : (
        <EmptyState title="No orders yet" description="Services you order from the shop appear here, with your invoices." action={<ButtonLink href={`${base}/shop`} mt="xs">Go to the shop</ButtonLink>} />
      )}
    </Stack>
  );
}
