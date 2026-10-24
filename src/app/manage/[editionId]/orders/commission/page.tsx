import { Alert, Paper, SimpleGrid, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { TextLink } from '@/components/links';
import { commissionReport } from '@/server/services/orders';
import { money } from '@/lib/format';
import { loadEdition } from '../../load';

export default async function CommissionPage({ params }: PageProps<'/manage/[editionId]/orders/commission'>) {
  const { editionId } = await params;
  const { actor, edition } = await loadEdition(editionId, 'orders');
  const r = await commissionReport(actor, edition.id);
  return (
    <Stack>
      <TextLink href={`/manage/${edition.id}/orders`} fz="sm">
        ← Orders
      </TextLink>
      <PageHeader
        title="Commission and payouts"
        description="What each supplier has sold, what Media10 keeps, and what has been paid out. Figures are after refunds and include paid and invoiced orders."
      />
      <SimpleGrid cols={{ base: 2, md: 4 }}>
        <StatCard label="Sales (incl. VAT)" value={money(r.totals.grossPence - r.totals.refundedPence)} hint={r.totals.refundedPence ? `${money(r.totals.refundedPence)} refunded` : undefined} />
        <StatCard label="Media10 keeps" value={money(r.totals.commissionPence)} hint="Commission and its own services, before VAT" />
        <StatCard label="Owed to suppliers" value={money(r.totals.payoutPence)} hint="Their share plus VAT where registered" />
        <StatCard label="Card fees collected" value={money(r.totals.cardFeesCollectedPence)} hint="Charged to exhibitors on top" />
      </SimpleGrid>
      <Alert color="blue" variant="light">
        Card orders are paid out to suppliers through Stripe automatically. Invoice orders are paid out by finance once the exhibitor has paid; record each one on the order.
      </Alert>
      <Paper withBorder>
        <Table verticalSpacing="sm" striped>
          <TableThead>
            <TableTr>
              <TableTh>Supplier</TableTh>
              <TableTh ta="right">Orders</TableTh>
              <TableTh ta="right">Sales</TableTh>
              <TableTh ta="right">Net</TableTh>
              <TableTh ta="right">Commission</TableTh>
              <TableTh ta="right">Card fees</TableTh>
              <TableTh ta="right">Payout due</TableTh>
              <TableTh ta="right">Paid out</TableTh>
              <TableTh ta="right">Still to pay</TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {r.suppliers.map((s) => {
              const t = s.transfers;
              const stillToPay = t ? t.waiting + t.manualOwed + s.awaitingPaymentPence : 0;
              return (
                <TableTr key={s.key}>
                  <TableTd>
                    <Text fz="sm" fw={600}>
                      {s.name}
                    </Text>
                    {s.awaitingPaymentPence ? (
                      <Text fz="xs" c="dimmed">
                        {money(s.awaitingPaymentPence)} on invoices not yet paid
                      </Text>
                    ) : null}
                  </TableTd>
                  <TableTd ta="right">{s.orders}</TableTd>
                  <TableTd ta="right">{money(s.grossPence - s.refundedPence)}</TableTd>
                  <TableTd ta="right">{money(s.netPence)}</TableTd>
                  <TableTd ta="right">{money(s.commissionPence)}</TableTd>
                  <TableTd ta="right">{s.cardFeePence ? money(s.cardFeePence) : '—'}</TableTd>
                  <TableTd ta="right">{s.key === 'media10' ? '—' : money(s.payoutPence + s.awaitingPaymentPence)}</TableTd>
                  <TableTd ta="right">{t ? money(t.sent + t.manualSettled) : '—'}</TableTd>
                  <TableTd ta="right">
                    {t ? (
                      <Text fz="sm" c={stillToPay ? 'orange' : undefined} fw={stillToPay ? 600 : undefined}>
                        {money(stillToPay)}
                      </Text>
                    ) : (
                      '—'
                    )}
                  </TableTd>
                </TableTr>
              );
            })}
          </TableTbody>
        </Table>
        {!r.suppliers.length ? (
          <Text p="md" c="dimmed" fz="sm">
            No sales yet.
          </Text>
        ) : null}
      </Paper>
    </Stack>
  );
}
