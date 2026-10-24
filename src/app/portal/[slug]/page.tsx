import { Alert, Badge, Group, Paper, Progress, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { ButtonLink, TextLink } from '@/components/links';
import { RichHtml } from '@/components/rich-html';
import { checklistForStand } from '@/server/services/submissions';
import { pagesForType } from '@/server/services/manual';
import { announcementsForType } from '@/server/services/announcements';
import { dateLong, dateTime, daysUntil } from '@/lib/format';
import { TASK_STATE_LABELS } from '@/lib/task-labels';
import { loadPortal } from './load';

export default async function PortalHome({ params }: PageProps<'/portal/[slug]'>) {
  const { slug } = await params;
  const ctx = await loadPortal(slug);
  const [checklist, pages, news] = await Promise.all([
    checklistForStand(ctx.actor, ctx.stand.id),
    pagesForType(ctx.edition.id, ctx.stand.typeId),
    announcementsForType(ctx.edition.id, ctx.stand.typeId, 6),
  ]);
  const base = `/portal/${ctx.edition.slug}`;
  const p = checklist.progress;
  const pct = p.required ? Math.round((p.requiredDone / p.required) * 100) : 100;
  const next = checklist.items
    .filter((i) => !i.done && i.state !== 'submitted')
    .sort((a, b) => (a.deadline?.getTime() ?? Infinity) - (b.deadline?.getTime() ?? Infinity))
    .slice(0, 5);
  const firstName = (ctx.actor.name || '').split(' ')[0];
  const toShow = daysUntil(ctx.edition.openStartsAt);
  const brand = ctx.edition.branding.accentColor ?? undefined;
  return (
    <Stack>
      <div>
        <Title order={1} fz={26}>
          {firstName ? `Welcome, ${firstName}` : 'Welcome'}
        </Title>
        <Text c="dimmed">
          {ctx.stand.companyName} · stand {ctx.stand.number} · {ctx.stand.typeName}
          {ctx.stand.hallName ? ` · hall ${ctx.stand.hallName}` : ''}
          {ctx.stand.sizeSqm ? ` · ${Number(ctx.stand.sizeSqm)} sqm` : ''}
        </Text>
      </div>
      {ctx.closedReason ? <Alert color="gray">{ctx.closedReason}</Alert> : null}
      {p.overdue || p.changesNeeded ? (
        <Alert color="orange" icon={<IconAlertTriangle size={18} />} title="Needs your attention">
          {p.overdue ? `${p.overdue} required ${p.overdue === 1 ? 'task is' : 'tasks are'} past the deadline. ` : ''}
          {p.changesNeeded ? `The show team has asked for changes on ${p.changesNeeded} ${p.changesNeeded === 1 ? 'task' : 'tasks'}.` : ''}{' '}
          <TextLink href={`${base}/checklist`}>Open your checklist</TextLink>
        </Alert>
      ) : null}

      <SimpleGrid cols={{ base: 1, md: 3 }}>
        <Paper withBorder p="md">
          <Text fz="xs" fw={700} c="dimmed" tt="uppercase">
            Your checklist
          </Text>
          <Text fz={28} fw={700}>
            {pct}%
          </Text>
          <Progress value={pct} color={brand} mb={6} />
          <Text fz="sm" c="dimmed">
            {p.requiredDone} of {p.required} required tasks done
          </Text>
        </Paper>
        <Paper withBorder p="md">
          <Text fz="xs" fw={700} c="dimmed" tt="uppercase">
            Show opens
          </Text>
          <Text fz={28} fw={700}>
            {toShow === null ? '—' : toShow > 0 ? `${toShow} days` : toShow === 0 ? 'Today' : 'Open'}
          </Text>
          <Text fz="sm" c="dimmed">
            {ctx.edition.openStartsAt ? dateLong(ctx.edition.openStartsAt) : 'Date to be confirmed'}
          </Text>
        </Paper>
        <Paper withBorder p="md">
          <Text fz="xs" fw={700} c="dimmed" tt="uppercase">
            Build-up
          </Text>
          <Text fz="sm" mt={6}>
            Starts {ctx.edition.buildUpStartsAt ? dateTime(ctx.edition.buildUpStartsAt) : 'to be confirmed'}
          </Text>
          <Text fz="sm">Breakdown ends {ctx.edition.breakdownEndsAt ? dateTime(ctx.edition.breakdownEndsAt) : 'to be confirmed'}</Text>
          {ctx.edition.venue ? (
            <Text fz="sm" c="dimmed">
              {[ctx.edition.venue, ctx.edition.city].filter(Boolean).join(', ')}
            </Text>
          ) : null}
        </Paper>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <Paper withBorder p="md">
          <Group justify="space-between" mb="sm">
            <Title order={2} fz="md">
              Coming up
            </Title>
            <TextLink href={`${base}/checklist`} fz="sm">
              See everything
            </TextLink>
          </Group>
          {next.length ? (
            <Stack gap="xs">
              {next.map((i) => (
                <Group key={i.task.id} justify="space-between" wrap="nowrap">
                  <div style={{ minWidth: 0 }}>
                    <TextLink href={`${base}/tasks/${i.task.id}`} fz="sm" fw={600}>
                      {i.task.title}
                    </TextLink>
                    <Text fz="xs" c="dimmed">
                      {i.deadline ? `Due ${dateTime(i.deadline)}` : 'No deadline'}
                    </Text>
                  </div>
                  <Badge variant="light" color={TASK_STATE_LABELS[i.state].color}>
                    {TASK_STATE_LABELS[i.state].label}
                  </Badge>
                </Group>
              ))}
            </Stack>
          ) : (
            <Text fz="sm" c="dimmed">
              You are all up to date.
            </Text>
          )}
          {next[0] && ctx.editable ? (
            <ButtonLink href={`${base}/tasks/${next[0].task.id}`} mt="md" color={brand}>
              Start your next task
            </ButtonLink>
          ) : null}
        </Paper>
        <Stack>
          {news.slice(0, 5).map((a) => (
            <Paper key={a.id} withBorder p="md">
              <Group gap="xs" mb={4}>
                <Title order={3} fz="md">
                  {a.title}
                </Title>
                {a.pinned ? (
                  <Badge size="xs" color="yellow">
                    Pinned
                  </Badge>
                ) : null}
              </Group>
              <Text fz="xs" c="dimmed" mb={4}>
                {dateLong(a.publishedAt)}
              </Text>
              <RichHtml html={a.bodyHtml} />
            </Paper>
          ))}
          {news.length > 5 ? (
            <TextLink href={`${base}/announcements`} fz="sm">
              See all announcements
            </TextLink>
          ) : null}
          <Paper withBorder p="md">
            <Title order={2} fz="md" mb="sm">
              Useful pages
            </Title>
            <Stack gap={4}>
              {(pages.filter((pg) => pg.pinned).length ? pages.filter((pg) => pg.pinned) : pages.slice(0, 6)).map((pg) => (
                <TextLink key={pg.id} href={`${base}/manual/${pg.slug}`} fz="sm">
                  {pg.title}
                </TextLink>
              ))}
              {!pages.length ? (
                <Text fz="sm" c="dimmed">
                  The manual is being prepared.
                </Text>
              ) : null}
            </Stack>
          </Paper>
        </Stack>
      </SimpleGrid>
    </Stack>
  );
}
