import { Alert, Anchor, Group, Paper, SimpleGrid, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from '@mantine/core';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { TextLink } from '@/components/links';
import { FULFILMENT_LABELS, ORDER_STATUS_LABELS, orderForExhibitor } from '@/server/services/orders';
import { confirmCheckoutReturn } from '@/server/services/shop';
import { AppError } from '@/server/errors';
import { dateLong, dateTime, money } from '@/lib/format';
import { loadPortal } from '../../load';
import { CancelCheckoutButton } from './cancel-checkout';

export default async function MyOrder({ params, searchParams }: PageProps<'/portal/[slug]/orders/[orderId]'>) {
  const { slug, orderId } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) notFound();
  const ctx = await loadPortal(slug);
  let view: Awaited<ReturnType<typeof orderForExhibitor>>;
  try {
    // Back from the payment page: ask the payment provider directly rather than wait for its webhook.
    if (sp.checkout === 'done') await confirmCheckoutReturn(ctx.actor, orderId);
    view = await orderForExhibitor(ctx.actor, orderId);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
  const o = view.order;
  const tz = ctx.edition.timezone;
  const base = `/portal/${ctx.edition.slug}`;
  return (
    <Stack>
      <TextLink href={`${base}/orders`} fz="sm">
        ← Your orders
      </TextLink>
      <PageHeader title={`Order ${o.number}`} description={`Stand ${view.stand.number} · placed ${dateTime(o.createdAt, tz)}${view.placedBy ? ` by ${view.placedBy}` : ''}`} actions={<StatusBadge status={o.status} label={ORDER_STATUS_LABELS[o.status]} />} />
      {sp.checkout === 'done' && o.status === 'paid' ? <Alert color="green" title="Thank you, your payment went through">Your order is confirmed and your VAT invoice is below. We have emailed you a copy of the confirmation.</Alert> : null}
      {sp.placed && o.status === 'invoiced' ? <Alert color="green" title="Order placed">Your order is confirmed. Your VAT invoice is below and payment is due by {o.dueAt ? dateLong(o.dueAt, tz) : 'the date on the invoice'}.</Alert> : null}
      {o.status === 'pending_payment' ? (
        <Alert color="yellow" title="Waiting for payment">
          <Stack gap="xs">
            <Text fz="sm">If you have just paid, this can take a minute to confirm. Refresh this page shortly. Unpaid orders are released after an hour.</Text>
            {ctx.editable ? (
              <Group>
                <CancelCheckoutButton slug={ctx.edition.slug} orderId={o.id} />
              </Group>
            ) : null}
          </Stack>
        </Alert>
      ) : null}
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Paper withBorder p="md">
          <Text fz="xs" c="dimmed" fw={600} tt="uppercase">
            Payment
          </Text>
          <Text fw={600}>{o.paymentMethod === 'card' ? 'Card' : 'Invoice'}</Text>
          {o.poNumber ? <Text fz="sm">Your PO number: {o.poNumber}</Text> : null}
          {o.paidAt ? <Text fz="sm">Paid {dateTime(o.paidAt, tz)}</Text> : null}
          {o.status === 'invoiced' && o.dueAt ? <Text fz="sm">Payment due {dateLong(o.dueAt, tz)}</Text> : null}
        </Paper>
        <Paper withBorder p="md">
          <Text fz="xs" c="dimmed" fw={600} tt="uppercase">
            Invoices and credit notes
          </Text>
          {view.documents.length ? (
            view.documents.map((d) => (
              <Group key={d.id} justify="space-between">
                {d.fileId ? (
                  <Anchor href={`/files/${d.fileId}`} fz="sm">
                    {d.kind === 'credit_note' ? 'Credit note' : 'VAT invoice'} {d.number} (PDF)
                  </Anchor>
                ) : (
                  <Text fz="sm">{d.number} (being prepared)</Text>
                )}
                <Text fz="sm">{money(d.totalPence)}</Text>
              </Group>
            ))
          ) : (
            <Text fz="sm" c="dimmed">
              Your VAT invoice appears here once the order is paid.
            </Text>
          )}
        </Paper>
      </SimpleGrid>
      <Paper withBorder>
        <Table verticalSpacing="sm">
          <TableThead>
            <TableTr>
              <TableTh>Item</TableTh>
              <TableTh ta="right">Qty</TableTh>
              <TableTh ta="right">Before VAT</TableTh>
              <TableTh ta="right">VAT</TableTh>
              <TableTh>Status</TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {view.lines.map((l) => (
              <TableTr key={l.id}>
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
                  {l.supplierName ? (
                    <Text fz="xs" c="dimmed">
                      Supplied by {l.supplierName}
                    </Text>
                  ) : null}
                  {l.refundedPence ? (
                    <Text fz="xs" c="grape">
                      {money(l.refundedPence)} refunded
                    </Text>
                  ) : null}
                </TableTd>
                <TableTd ta="right">{l.quantity}</TableTd>
                <TableTd ta="right">{money(l.netPence)}</TableTd>
                <TableTd ta="right">{money(l.vatPence)}</TableTd>
                <TableTd>
                  <StatusBadge status={l.fulfilmentStatus} label={l.fulfilmentStatus === 'received' ? 'Ordered' : FULFILMENT_LABELS[l.fulfilmentStatus]} />
                </TableTd>
              </TableTr>
            ))}
          </TableTbody>
        </Table>
        <Stack gap={4} p="md" maw={360} ml="auto">
          <Group justify="space-between">
            <Text fz="sm">Before VAT</Text>
            <Text fz="sm">{money(o.netPence)}</Text>
          </Group>
          <Group justify="space-between">
            <Text fz="sm">VAT</Text>
            <Text fz="sm">{money(o.vatPence)}</Text>
          </Group>
          {o.cardFeePence ? (
            <Group justify="space-between">
              <Text fz="sm">Card processing fee</Text>
              <Text fz="sm">{money(o.cardFeePence)}</Text>
            </Group>
          ) : null}
          <Group justify="space-between">
            <Text fw={700}>Total</Text>
            <Text fw={700}>{money(o.totalPence)}</Text>
          </Group>
          {o.refundedPence ? (
            <Group justify="space-between">
              <Text fz="sm" c="grape">
                Refunded
              </Text>
              <Text fz="sm" c="grape">
                {money(o.refundedPence)}
              </Text>
            </Group>
          ) : null}
        </Stack>
      </Paper>
    </Stack>
  );
}
