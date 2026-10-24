import { Badge, Group, List, ListItem, Paper, Progress, SimpleGrid, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconCheck, IconCircleDashed } from '@tabler/icons-react';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { StatusBadge } from '@/components/ui/status-badge';
import { TextLink } from '@/components/links';
import { editionOverview } from '@/server/services/overview';
import { dateLong, daysUntil, plural } from '@/lib/format';
import { loadEdition } from './load';

export default async function EditionOverview({ params }: PageProps<'/manage/[editionId]'>) {
  const { editionId } = await params;
  const { actor, edition, isAdmin } = await loadEdition(editionId);
  const o = await editionOverview(actor, edition.id);
  const base = `/manage/${edition.id}`;
  const joinedPct = o.summary.companies ? Math.round((o.summary.joined / o.summary.companies) * 100) : 0;
  const toBuild = daysUntil(edition.buildUpStartsAt);
  const doneSteps = o.setup.filter((s) => s.done).length;
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
        <StatCard label="Invitations waiting" value={o.summary.invited + o.summary.notSent} hint={o.summary.notSent ? `${o.summary.notSent} not sent yet` : 'All sent'} />
        <StatCard
          label="Build-up"
          value={toBuild === null ? '—' : toBuild > 0 ? `${toBuild} days` : toBuild === 0 ? 'Today' : 'Started'}
          hint={edition.buildUpStartsAt ? dateLong(edition.buildUpStartsAt) : 'Date not set'}
        />
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
        </Paper>

        <Paper withBorder p="md">
          <Title order={2} fz="md" mb={4}>
            Getting the show ready
          </Title>
          <Text fz="sm" c="dimmed" mb="sm">
            {doneSteps} of {o.setup.length} done
          </Text>
          <Progress value={(doneSteps / o.setup.length) * 100} mb="sm" />
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
              <Text fz="xs" c="dimmed" fw={600} tt="uppercase">
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
