import { Badge, Group, List, ListItem, Paper, Progress, SimpleGrid, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, ThemeIcon, Title } from '@mantine/core';
import { IconCheck, IconCircleDashed } from '@tabler/icons-react';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { StatusBadge } from '@/components/ui/status-badge';
import { TextLink } from '@/components/links';
import { editionOverview } from '@/server/services/overview';
import { dateLong, dateShort, daysUntil, money, plural } from '@/lib/format';
import { loadEdition } from './load';
import { EmailStandsButton } from './overview-controls';

function Attention({ label, value, href, tone }: { label: string; value: number; href: string; tone: 'red' | 'blue' | 'orange' | 'gray' }) {
  return (
    <Paper withBorder p="sm">
      <Text fz="sm" fw={500} c="dimmed" lh={1.3}>
        {label}
      </Text>
      <Group justify="space-between" align="flex-end" mt={4} wrap="nowrap">
        <Text className="bp-figure" fz={30} c={value ? tone : undefined}>
          {value}
        </Text>
        {value ? (
          <TextLink href={href} fz="sm">
            Open
          </TextLink>
        ) : (
          <Badge variant="light" color="green" style={{ flexShrink: 0 }}>
            All clear
          </Badge>
        )}
      </Group>
    </Paper>
  );
}

export default async function EditionOverview({ params }: PageProps<'/manage/[editionId]'>) {
  const { editionId } = await params;
  const { actor, edition, isAdmin, access } = await loadEdition(editionId);
  const o = await editionOverview(actor, edition.id);
  const base = `/manage/${edition.id}`;
  const joinedPct = o.summary.companies ? Math.floor((o.summary.joined / o.summary.companies) * 100) : 0;
  const toBuild = daysUntil(edition.buildUpStartsAt);
  const doneSteps = o.setup.filter((s) => s.done).length;
  const setupDone = doneSteps === o.setup.length;
  const canEmail = access.permissions.has('send_emails') && !actor.readOnly;
  return (
    <Stack>
      <PageHeader
        title="Overview"
        description={[edition.venue, edition.city].filter(Boolean).join(', ') || undefined}
        actions={<StatusBadge status={edition.status} />}
      />
      <SimpleGrid cols={{ base: 2, md: 4 }}>
        <StatCard label="Exhibitors" value={o.summary.companies} hint={plural(o.standTotal, 'stand')} />
        <StatCard label="Signed up" value={`${joinedPct}%`} hint={`${o.summary.joined} of ${o.summary.companies} companies`} />
        <StatCard
          label="Checklists done"
          value={o.checklist.requiredItems ? `${o.checklist.pct}%` : '—'}
          hint={o.checklist.requiredItems ? `${o.checklist.requiredDone} of ${o.checklist.requiredItems} required tasks · ${o.checklist.standsComplete} stands finished` : 'No required tasks yet'}
        />
        <StatCard
          label="Build-up"
          value={toBuild === null ? '—' : toBuild > 0 ? `${toBuild} days` : toBuild === 0 ? 'Today' : 'Started'}
          hint={edition.buildUpStartsAt ? dateLong(edition.buildUpStartsAt) : 'Date not set'}
        />
      </SimpleGrid>

      <div>
        <Title order={2} fz="md" mb="xs">
          Needs attention
        </Title>
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: Math.min(6, 3 + (o.spaceOnly ? 1 : 0) + (o.emails ? 1 : 0) + (o.questions !== null ? 1 : 0)) }}>
          <Attention label="Stands with overdue tasks" value={o.checklist.standsOverdue} href={`${base}/exhibitors?progress=behind`} tone="red" />
          <Attention label="Waiting for your review" value={o.checklist.awaitingReview} href={`${base}/exhibitors?progress=review`} tone="blue" />
          {o.spaceOnly ? <Attention label="Space-only packs to review" value={o.spaceOnly.toReview} href={`${base}/space-only`} tone="blue" /> : null}
          {o.questions !== null ? <Attention label="Questions for the team" value={o.questions} href={`${base}/help-desk`} tone="blue" /> : null}
          <Attention label="Invitations not sent" value={o.summary.notSent} href={`${base}/exhibitors?state=not_sent`} tone="orange" />
          {o.emails ? <Attention label="Emails bounced (7 days)" value={o.emails.problems7d} href={`${base}/emails?tab=sent&filter=problems`} tone="orange" /> : null}
        </SimpleGrid>
      </div>

      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <Paper withBorder p="md">
          <Group justify="space-between" mb="sm">
            <Title order={2} fz="md">
              Deadlines
            </Title>
            <TextLink href={`${base}/tasks`} fz="sm">
              All tasks
            </TextLink>
          </Group>
          {o.deadlines.length ? (
            <Table verticalSpacing={6}>
              <TableThead>
                <TableTr>
                  <TableTh>Task</TableTh>
                  <TableTh w={110}>Due</TableTh>
                  <TableTh w={170}>Done</TableTh>
                </TableTr>
              </TableThead>
              <TableTbody>
                {o.deadlines.map((t) => {
                  const pctDone = t.applies ? Math.floor((t.done / t.applies) * 100) : 0;
                  const past = t.past;
                  return (
                    <TableTr key={t.id}>
                      <TableTd>
                        <TextLink href={`${base}/tasks/${t.id}?tab=responses`} fz="sm">
                          {t.title}
                        </TextLink>
                      </TableTd>
                      <TableTd>
                        <Text fz="sm" c={past ? 'red' : undefined}>
                          {dateShort(t.deadline)}
                        </Text>
                      </TableTd>
                      <TableTd>
                        <Group gap={6} wrap="nowrap">
                          <Progress value={pctDone} size="sm" w={70} color={past && pctDone < 100 ? 'red' : 'blue'} aria-label={`${pctDone}% done`} />
                          <Text fz="xs">
                            {t.done} of {t.applies}
                          </Text>
                        </Group>
                      </TableTd>
                    </TableTr>
                  );
                })}
              </TableTbody>
            </Table>
          ) : (
            <Text fz="sm" c="dimmed">
              No deadlines in the next 30 days.
            </Text>
          )}
        </Paper>

        <Paper withBorder p="md">
          <Group justify="space-between" mb="sm">
            <Title order={2} fz="md">
              Stands to chase
            </Title>
            {o.nudge.length && canEmail ? <EmailStandsButton editionId={edition.id} standIds={o.nudge.map((s) => s.standId)} /> : null}
          </Group>
          {o.nudge.length ? (
            <Stack gap={6}>
              {o.nudge.map((s) => (
                <Group key={s.standId} justify="space-between" wrap="nowrap">
                  <div style={{ minWidth: 0 }}>
                    <TextLink href={`${base}/exhibitors/${s.companyId}`} fz="sm" fw={600}>
                      {s.companyName}
                    </TextLink>
                    <Text fz="xs" c="dimmed">
                      Stand {s.number} · {s.requiredDone} of {s.required} done
                    </Text>
                  </div>
                  <Badge color="red" variant="light">
                    {s.overdue} overdue
                  </Badge>
                </Group>
              ))}
              {o.checklist.standsOverdue > o.nudge.length ? (
                <TextLink href={`${base}/exhibitors?progress=behind`} fz="sm">
                  See all {o.checklist.standsOverdue} stands with overdue tasks
                </TextLink>
              ) : null}
            </Stack>
          ) : (
            <Text fz="sm" c="dimmed">
              Nobody is behind. Stands with overdue tasks will appear here.
            </Text>
          )}
        </Paper>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <Paper withBorder p="md">
          <Title order={2} fz="md" mb="sm">
            Stands by type
          </Title>
          <Stack gap="xs">
            {o.byType.map((t) => (
              <Group key={t.name} justify="space-between">
                <Group gap="xs">
                  <Text fz="sm">{t.name}</Text>
                  {t.isSpaceOnly ? (
                    <Badge size="xs" variant="light" color="orange">
                      Needs approval
                    </Badge>
                  ) : null}
                </Group>
                <Text fz="sm" fw={600}>
                  {t.stands}
                </Text>
              </Group>
            ))}
          </Stack>
          <Text fz="sm" mt="sm">
            <TextLink href={`${base}/exhibitors`}>See all exhibitors</TextLink>
            {o.summary.unassignedStands ? ` · ${plural(o.summary.unassignedStands, 'stand')} without a company` : ''}
          </Text>
          {o.spaceOnly && o.spaceOnly.total ? (
            <Text fz="sm" mt={4} c="dimmed">
              Space-only: {o.spaceOnly.approved} of {o.spaceOnly.total} approved{o.spaceOnly.chase ? `, ${o.spaceOnly.chase} to chase` : ''}.
            </Text>
          ) : null}
        </Paper>

        {o.shop ? (
          <Paper withBorder p="md">
            <Group justify="space-between" mb="sm">
              <Title order={2} fz="md">
                Shop
              </Title>
              <TextLink href={`${base}/orders`} fz="sm">
                Orders
              </TextLink>
            </Group>
            <SimpleGrid cols={3}>
              <div>
                <Text fz="sm" c="dimmed" fw={500}>
                  Orders
                </Text>
                <Text className="bp-figure" fz={26}>
                  {o.shop.orders}
                </Text>
              </div>
              <div>
                <Text fz="sm" c="dimmed" fw={500}>
                  Sales
                </Text>
                <Text className="bp-figure" fz={26}>
                  {money(o.shop.salesPence)}
                </Text>
              </div>
              <div>
                <Text fz="sm" c="dimmed" fw={500}>
                  Unpaid invoices
                </Text>
                <Text className="bp-figure" fz={26}>
                  {money(o.shop.awaitingPence)}
                </Text>
              </div>
            </SimpleGrid>
            <Text fz="sm" mt="sm">
              <TextLink href={`${base}/orders/services`}>Services by stand</TextLink> · <TextLink href={`${base}/reports`}>Reports</TextLink>
            </Text>
          </Paper>
        ) : null}

        {!setupDone || edition.status === 'draft' ? (
          <Paper withBorder p="md">
            <Title order={2} fz="md" mb={4}>
              Getting the show ready
            </Title>
            <Text fz="sm" c="dimmed" mb="sm">
              {doneSteps} of {o.setup.length} done
            </Text>
            <Progress value={(doneSteps / o.setup.length) * 100} mb="sm" aria-label={`${doneSteps} of ${o.setup.length} set-up steps done`} />
            <List spacing={6} size="sm" center>
              {o.setup.map((s) => (
                <ListItem
                  key={s.key}
                  icon={
                    <ThemeIcon size={20} radius="xl" color={s.done ? 'green' : 'gray'} variant={s.done ? 'filled' : 'light'}>
                      {s.done ? <IconCheck size={12} /> : <IconCircleDashed size={12} />}
                    </ThemeIcon>
                  }
                >
                  {isAdmin || s.key === 'stands' ? <TextLink href={`${base}/${s.href}`}>{s.label}</TextLink> : s.label}
                </ListItem>
              ))}
            </List>
          </Paper>
        ) : null}
      </SimpleGrid>

      <Paper withBorder p="md">
        <Title order={2} fz="md" mb="sm">
          Key dates
        </Title>
        <SimpleGrid cols={{ base: 2, md: 4 }}>
          {[
            ['Build-up starts', edition.buildUpStartsAt],
            ['Show opens', edition.openStartsAt],
            ['Show closes', edition.openEndsAt],
            ['Breakdown ends', edition.breakdownEndsAt],
          ].map(([label, d]) => (
            <div key={String(label)}>
              <Text fz="sm" c="dimmed" fw={500}>
                {String(label)}
              </Text>
              <Text fz="sm">{d ? dateLong(d as Date) : 'Not set'}</Text>
            </div>
          ))}
        </SimpleGrid>
      </Paper>
    </Stack>
  );
}
