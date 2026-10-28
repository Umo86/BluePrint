import { Alert, Anchor, Badge, Group, Paper, SimpleGrid, Stack, Table, TableTbody, TableTd, TableTfoot, TableTh, TableThead, TableTr, Text, Title } from '@mantine/core';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { TextLink } from '@/components/links';
import { FULFILMENT_LABELS, ORDER_STATUS_LABELS, orderForStaff } from '@/server/services/orders';
import { AppError } from '@/server/errors';
import { dateTime, money, percentFromBps } from '@/lib/format';
import { loadEdition } from '../../load';
import { FulfilmentSelect } from '@/components/fulfilment-select';
import { CancelOrderButton, MarkPaidButton, RefundButton, RetryTransferButton, SettleTransferButton } from './order-controls';
import { OrderLineDetails } from '@/components/order-line-details';

const TRANSFER_LABELS: Record<string, string> = {
  pending: 'Waiting',
  created: 'Paid out',
  failed: 'Failed',
  reversed: 'Taken back',
  partially_reversed: 'Partly taken back',
  manual: 'To pay by hand',
};

export default async function OrderDetail({ params }: PageProps<'/manage/[editionId]/orders/[orderId]'>) {
  const { editionId, orderId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) notFound();
  const { actor, edition } = await loadEdition(editionId, 'orders');
  let d: Awaited<ReturnType<typeof orderForStaff>>;
  try {
    d = await orderForStaff(actor, orderId);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
  if (d.order.editionId !== edition.id) notFound();
  const o = d.order;
  const tz = edition.timezone;
  const live = ['paid', 'invoiced', 'partially_refunded'].includes(o.status);
  const refundable = o.paymentMethod === 'card' ? ['paid', 'partially_refunded'].includes(o.status) : ['invoiced', 'paid', 'partially_refunded'].includes(o.status);
  return (
    <Stack>
      <TextLink href={`/manage/${edition.id}/orders`} fz="sm">
        ← Orders
      </TextLink>
      <PageHeader
        title={`Order ${o.number}`}
        description={`${d.company?.name ?? 'Exhibitor'} · stand ${d.stand.number}${d.hall ? `, hall ${d.hall.name}` : ''} · placed ${dateTime(o.createdAt, tz)}`}
        actions={
          <Group gap="xs">
            <StatusBadge status={o.status} label={ORDER_STATUS_LABELS[o.status]} />
            {d.canManage && o.status === 'invoiced' ? <MarkPaidButton orderId={o.id} /> : null}
            {d.canManage && refundable && !d.canRefund ? (
              <Text fz="xs" c="dimmed" maw={220}>
                Refunds are made by show admins and people given the Refunds right.
              </Text>
            ) : null}
            {d.canRefund && refundable ? (
              <RefundButton
                orderId={o.id}
                viaCard={o.paymentMethod === 'card' && Boolean(o.stripePaymentIntentId)}
                cardFeeRefundable={d.cardFeeRefundable}
                lines={d.lines.map((l) => ({ id: l.id, description: `${l.quantity} × ${l.description}`, refundablePence: l.grossPence - l.refundedPence }))}
              />
            ) : null}
            {d.canManage && (o.status === 'pending_payment' || o.status === 'invoiced') ? <CancelOrderButton orderId={o.id} invoiced={o.status === 'invoiced'} /> : null}
          </Group>
        }
      />
      {d.refunds.some((r) => r.status === 'failed') ? (
        <Alert color="red" title="A refund failed">
          Stripe did not complete a refund on this order. Contact the exhibitor and refund them another way, then record it with finance.
        </Alert>
      ) : null}

      <SimpleGrid cols={{ base: 1, md: 3 }}>
        <Paper withBorder p="md">
          <Text fz="sm" c="dimmed" fw={500}>
            Exhibitor
          </Text>
          <Text fw={600}>{d.company?.name ?? '—'}</Text>
          <Text fz="sm">
            Stand {d.stand.number}
            {d.hall ? `, hall ${d.hall.name}` : ''}
          </Text>
          {d.placer ? (
            <Text fz="sm" mt={6}>
              Ordered by {d.placer.name || d.placer.email}
              <br />
              <Anchor href={`mailto:${d.placer.email}`} fz="sm">
                {d.placer.email}
              </Anchor>
              {d.placer.phone ? ` · ${d.placer.phone}` : ''}
            </Text>
          ) : null}
          {d.company ? (
            <TextLink href={`/manage/${edition.id}/exhibitors/${d.company.id}`} fz="sm">
              Exhibitor record
            </TextLink>
          ) : null}
        </Paper>
        <Paper withBorder p="md">
          <Text fz="sm" c="dimmed" fw={500}>
            Payment
          </Text>
          <Text fw={600}>{o.paymentMethod === 'card' ? 'Card' : 'Invoice'}</Text>
          {o.poNumber ? <Text fz="sm">PO number {o.poNumber}</Text> : null}
          {o.paidAt ? <Text fz="sm">Paid {dateTime(o.paidAt, tz)}</Text> : null}
          {o.paymentReference ? <Text fz="sm">Reference {o.paymentReference}</Text> : null}
          {o.status === 'invoiced' && o.dueAt ? (
            <Text fz="sm" c={o.dueAt < new Date() ? 'red' : undefined}>
              Due {dateTime(o.dueAt, tz)}
            </Text>
          ) : null}
          {o.cancelledAt ? <Text fz="sm">Cancelled {dateTime(o.cancelledAt, tz)}</Text> : null}
          {o.stripePaymentIntentId && d.paymentsMode === 'stripe' ? (
            <Text fz="xs" c="dimmed" mt={4}>
              Stripe payment {o.stripePaymentIntentId}
            </Text>
          ) : null}
        </Paper>
        <Paper withBorder p="md">
          <Text fz="sm" c="dimmed" fw={500}>
            Documents
          </Text>
          {d.documents.length ? (
            d.documents.map((doc) => (
              <Group key={doc.id} justify="space-between">
                {/* A document that could not be stored (file storage off) is drawn from the order instead. */}
                <Anchor href={doc.fileId ? `/files/${doc.fileId}` : `/files/documents/${doc.id}`} fz="sm">
                  {doc.kind === 'credit_note' ? 'Credit note' : 'Invoice'} {doc.number}
                </Anchor>
                <Text fz="sm">{money(doc.totalPence)}</Text>
              </Group>
            ))
          ) : (
            <Text fz="sm" c="dimmed">
              Issued once paid or invoiced.
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
              <TableTh ta="right">Net</TableTh>
              <TableTh ta="right">VAT</TableTh>
              <TableTh ta="right">Total</TableTh>
              <TableTh>Supplier</TableTh>
              <TableTh ta="right">Commission</TableTh>
              <TableTh ta="right">Supplier payout</TableTh>
              <TableTh>Status</TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {d.lines.map((l) => (
              <TableTr key={l.id}>
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
                  {l.refundedPence ? (
                    <Text fz="xs" c="grape">
                      {money(l.refundedPence)} refunded
                    </Text>
                  ) : null}
                </TableTd>
                <TableTd ta="right">{l.quantity}</TableTd>
                <TableTd ta="right">{money(l.netPence)}</TableTd>
                <TableTd ta="right">
                  {money(l.vatPence)}
                  <Text fz="xs" c="dimmed">
                    {percentFromBps(l.vatRateBps)}
                  </Text>
                </TableTd>
                <TableTd ta="right">{money(l.grossPence)}</TableTd>
                <TableTd>
                  <Text fz="sm">{l.supplierName ?? 'Organiser'}</Text>
                </TableTd>
                <TableTd ta="right">{money(l.commissionPence)}</TableTd>
                <TableTd ta="right">
                  {l.supplierId ? money(l.supplierPayoutPence) : '—'}
                  {l.cardFeeSharePence ? (
                    <Text fz="xs" c="dimmed">
                      after {money(l.cardFeeSharePence)} card fee
                    </Text>
                  ) : null}
                </TableTd>
                <TableTd>
                  {d.canManage && live && l.fulfilmentStatus !== 'cancelled' ? (
                    <FulfilmentSelect lineId={l.id} value={l.fulfilmentStatus} label={l.description} />
                  ) : (
                    <StatusBadge status={l.fulfilmentStatus} label={FULFILMENT_LABELS[l.fulfilmentStatus]} />
                  )}
                </TableTd>
              </TableTr>
            ))}
          </TableTbody>
          <TableTfoot>
            <TableTr>
              <TableTd colSpan={2}>
                <Text fz="sm" fw={600}>
                  Totals
                </Text>
              </TableTd>
              <TableTd ta="right">{money(o.netPence)}</TableTd>
              <TableTd ta="right">{money(o.vatPence)}</TableTd>
              <TableTd ta="right">
                <Text fw={700} fz="sm">
                  {money(o.totalPence)}
                </Text>
                {o.cardFeePence ? (
                  <Text fz="xs" c="dimmed">
                    incl. {money(o.cardFeePence)} card fee
                  </Text>
                ) : null}
              </TableTd>
              <TableTd />
              <TableTd ta="right">{money(o.commissionPence)}</TableTd>
              <TableTd colSpan={2}>
                {o.refundedPence ? (
                  <Text fz="sm" c="grape">
                    {money(o.refundedPence)} refunded
                  </Text>
                ) : null}
              </TableTd>
            </TableTr>
          </TableTfoot>
        </Table>
      </Paper>

      {d.transfers.length ? (
        <Paper withBorder p="md">
          <Title order={2} fz="md" mb="xs">
            Supplier payouts
          </Title>
          <Table>
            <TableThead>
              <TableTr>
                <TableTh>Supplier</TableTh>
                <TableTh ta="right">Amount</TableTh>
                <TableTh ta="right">Taken back</TableTh>
                <TableTh>Status</TableTh>
                <TableTh />
              </TableTr>
            </TableThead>
            <TableTbody>
              {d.transfers.map((t) => (
                <TableTr key={t.id}>
                  <TableTd>{t.supplierName}</TableTd>
                  <TableTd ta="right">{money(t.amountPence)}</TableTd>
                  <TableTd ta="right">{t.reversedPence ? money(t.reversedPence) : '—'}</TableTd>
                  <TableTd>
                    <Group gap={6}>
                      <StatusBadge status={t.status === 'created' ? 'paid' : t.status === 'manual' ? 'pending' : t.status} label={TRANSFER_LABELS[t.status]} />
                      {t.status === 'manual' && t.settledAt ? (
                        <Badge size="sm" color="green" variant="light">
                          Paid {dateTime(t.settledAt, tz)} · {t.reference}
                        </Badge>
                      ) : null}
                    </Group>
                    {t.error && (t.status === 'pending' || t.status === 'failed' || t.status === 'created' || t.status === 'partially_reversed') ? (
                      <Text fz="xs" c={t.status === 'failed' ? 'red' : 'dimmed'}>
                        {t.error}
                      </Text>
                    ) : null}
                  </TableTd>
                  <TableTd>
                    {d.canManage && (t.status === 'failed' || t.status === 'pending') ? <RetryTransferButton transferId={t.id} /> : null}
                    {d.canManage && t.status === 'manual' && !t.settledAt ? <SettleTransferButton transferId={t.id} /> : null}
                  </TableTd>
                </TableTr>
              ))}
            </TableTbody>
          </Table>
        </Paper>
      ) : null}

      {d.refunds.length ? (
        <Paper withBorder p="md">
          <Title order={2} fz="md" mb="xs">
            Refunds and credits
          </Title>
          <Table>
            <TableThead>
              <TableTr>
                <TableTh>When</TableTh>
                <TableTh>Reason</TableTh>
                <TableTh>By</TableTh>
                <TableTh ta="right">Amount</TableTh>
                <TableTh>Status</TableTh>
              </TableTr>
            </TableThead>
            <TableTbody>
              {d.refunds.map((r) => (
                <TableTr key={r.id}>
                  <TableTd>{dateTime(r.createdAt, tz)}</TableTd>
                  <TableTd>
                    <Text fz="sm">{r.reason}</Text>
                    {r.error ? (
                      <Text fz="xs" c="red">
                        {r.error}
                      </Text>
                    ) : null}
                  </TableTd>
                  <TableTd>{r.byName ?? '—'}</TableTd>
                  <TableTd ta="right">{money(r.amountPence)}</TableTd>
                  <TableTd>
                    <StatusBadge status={r.status === 'succeeded' ? 'paid' : r.status} label={r.status === 'manual' ? 'Credit note (finance to settle)' : r.status === 'succeeded' ? 'Refunded to card' : r.status === 'pending' ? 'Processing' : 'Failed'} />
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
