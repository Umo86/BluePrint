import { Anchor, Badge, Paper, SimpleGrid, Stack, Table, TableScrollContainer, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { ActionButton } from '@/components/action-button';
import { TextLink } from '@/components/links';
import { basketsForStaff } from '@/server/services/baskets';
import { isDemoEdition } from '@/server/demo/flags';
import { sendBasketReminderAction } from '@/app/manage/shop-actions';
import { dateLong, dateTime, money } from '@/lib/format';
import { loadEdition } from '../../load';
import { BasketSettings } from './basket-settings';

/** Today, yesterday or so many days ago, by the calendar in the show's time zone. */
function ago(d: Date, now: Date, timeZone: string) {
  const day = (x: Date) => Date.parse(x.toLocaleDateString('en-CA', { timeZone }));
  const days = Math.round((day(now) - day(d)) / 86_400_000);
  if (days <= 0) return 'today';
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export default async function OpenBasketsPage({ params }: PageProps<'/manage/[editionId]/orders/baskets'>) {
  const { editionId } = await params;
  const { actor, edition } = await loadEdition(editionId, 'orders');
  const b = await basketsForStaff(actor, edition.id);
  const demo = await isDemoEdition(edition.id);
  const tz = edition.timezone;
  const now = new Date();
  const base = `/manage/${edition.id}`;
  const t = b.totals;
  return (
    <Stack>
      <TextLink href={`${base}/orders`} fz="sm">
        ← Orders
      </TextLink>
      <PageHeader
        title="Open baskets"
        description="Exhibitors who have put services in their basket but not ordered yet, biggest first. BluePrint reminds them by email; you can also send a reminder now, or give them a call."
      />
      <SimpleGrid cols={{ base: 2, md: 4 }}>
        <StatCard label="Open baskets" value={t.baskets} />
        <StatCard label="Waiting in baskets" value={money(t.valuePence)} hint="Including VAT" />
        <StatCard label="Reminders sent" value={t.remindersLast30Days} hint="In the last 30 days" />
        <StatCard label="Ordered after a reminder" value={money(t.recoveredPence)} hint={`${t.recoveredOrders} ${t.recoveredOrders === 1 ? 'order' : 'orders'} within two weeks of a reminder`} />
      </SimpleGrid>

      <Paper withBorder>
        {b.rows.length ? (
          <TableScrollContainer minWidth={980}>
            <Table verticalSpacing="sm">
              <TableThead>
                <TableTr>
                  <TableTh>Exhibitor</TableTh>
                  <TableTh>In the basket</TableTh>
                  <TableTh ta="right">Value</TableTh>
                  <TableTh>Last changed</TableTh>
                  <TableTh>Filled by</TableTh>
                  <TableTh>Reminders</TableTh>
                  {b.canManage ? <TableTh /> : null}
                </TableTr>
              </TableThead>
              <TableTbody>
                {b.rows.map((r) => (
                  <TableTr key={r.standId}>
                    <TableTd>
                      {r.companyId ? (
                        <TextLink href={`${base}/exhibitors/${r.companyId}`} fw={600} fz="sm">
                          {r.companyName}
                        </TextLink>
                      ) : (
                        <Text fz="sm" fw={600}>
                          {r.companyName}
                        </Text>
                      )}
                      <Text fz="xs" c="dimmed">
                        Stand {r.standNumber}
                        {r.hallName ? `, hall ${r.hallName}` : ''}
                      </Text>
                    </TableTd>
                    <TableTd maw={300}>
                      {r.items.slice(0, 3).map((i, n) => (
                        <Text key={n} fz="sm" c={i.problem ? 'dimmed' : undefined} td={i.problem ? 'line-through' : undefined}>
                          {i.quantity} × {i.name}
                        </Text>
                      ))}
                      {r.items.length > 3 ? (
                        <Text fz="xs" c="dimmed">
                          and {r.items.length - 3} more
                        </Text>
                      ) : null}
                      {r.next ? (
                        <Text fz="xs" c="orange">
                          {r.next.what} {dateLong(r.next.at, tz)}
                        </Text>
                      ) : null}
                    </TableTd>
                    <TableTd ta="right">
                      <Text fz="sm" fw={600}>
                        {money(r.totalPence)}
                      </Text>
                    </TableTd>
                    <TableTd>
                      <Text fz="sm">{ago(r.lastChange, now, tz)}</Text>
                      <Text fz="xs" c="dimmed">
                        {dateTime(r.lastChange, tz)}
                      </Text>
                    </TableTd>
                    <TableTd>
                      {r.addedBy.length ? (
                        r.addedBy.map((p) => (
                          <div key={p.email}>
                            <Text fz="sm">{p.name || p.email}</Text>
                            <Anchor href={`mailto:${p.email}`} fz="xs">
                              {p.email}
                            </Anchor>
                          </div>
                        ))
                      ) : (
                        <Text fz="xs" c="dimmed">
                          Not recorded
                        </Text>
                      )}
                    </TableTd>
                    <TableTd>
                      {r.payingNow ? (
                        <Badge color="blue" variant="light" mb={4}>
                          Paying now
                        </Badge>
                      ) : null}
                      {r.reminders.map((m, n) => (
                        <Text key={n} fz="xs">
                          Sent {dateTime(m.at, tz)}
                          {m.manual ? ' by the team' : ''}
                        </Text>
                      ))}
                      <Text fz="xs" c="dimmed">
                        {r.nextReminderAt
                          ? `Next: ${r.nextReminderAt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz })}, early morning`
                          : r.payingNow
                            ? 'Waiting for their payment'
                            : b.settings.enabled
                              ? r.reminders.length
                                ? 'No more automatic reminders'
                                : ''
                              : 'Reminders are switched off'}
                      </Text>
                    </TableTd>
                    {b.canManage ? (
                      <TableTd>
                        <ActionButton
                          action={sendBasketReminderAction}
                          args={[edition.id, r.standId]}
                          size="compact-sm"
                          variant="default"
                          confirm={{
                            title: `Send ${r.companyName} a reminder now?`,
                            body: 'They get the basket reminder email straight away, listing what is in their basket.',
                            confirmLabel: 'Send reminder',
                          }}
                        >
                          Send reminder now
                        </ActionButton>
                      </TableTd>
                    ) : null}
                  </TableTr>
                ))}
              </TableTbody>
            </Table>
          </TableScrollContainer>
        ) : (
          <Text p="md" fz="sm" c="dimmed">
            No open baskets. When an exhibitor puts services in their basket and leaves without ordering, they appear here.
          </Text>
        )}
      </Paper>

      {b.canManage ? <BasketSettings editionId={edition.id} initial={b.settings} demo={demo} /> : null}
    </Stack>
  );
}
