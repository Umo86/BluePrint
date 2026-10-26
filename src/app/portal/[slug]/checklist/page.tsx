import { Badge, Group, Paper, Progress, Stack, Text, Title } from '@mantine/core';
import { TextLink } from '@/components/links';
import { checklistForStand } from '@/server/services/submissions';
import { dateTime } from '@/lib/format';
import { EXHIBITOR_REQUIREMENT_LABELS, TASK_KIND_LABELS, TASK_STATE_LABELS } from '@/lib/task-labels';
import { loadPortal } from '../load';

export default async function Checklist({ params }: PageProps<'/portal/[slug]/checklist'>) {
  const { slug } = await params;
  const ctx = await loadPortal(slug);
  const { items, progress } = await checklistForStand(ctx.actor, ctx.stand.id);
  const base = `/portal/${ctx.edition.slug}`;
  const groups = [
    { title: 'To do', items: items.filter((i) => ['to_do', 'overdue', 'draft', 'changes_needed'].includes(i.state)) },
    { title: 'Waiting for the show team', items: items.filter((i) => i.state === 'submitted') },
    { title: 'Done', items: items.filter((i) => i.done || i.state === 'rejected') },
  ];
  return (
    <Stack>
      <div>
        <Title order={1} fz={26}>
          Your checklist
        </Title>
        <Text c="dimmed">Everything you need to do for stand {ctx.stand.number}, in order. Required tasks must be done by their deadline.</Text>
      </div>
      <Paper withBorder p="md">
        <Group justify="space-between" mb={6}>
          <Text fz="sm" fw={600}>
            {progress.requiredDone} of {progress.required} required tasks done
          </Text>
          {progress.overdue ? (
            <Badge color="red" variant="light">
              {progress.overdue} overdue
            </Badge>
          ) : null}
        </Group>
        <Progress
          value={progress.required ? (progress.requiredDone / progress.required) * 100 : 100}
          color={ctx.edition.branding.accentColor ?? undefined}
          aria-label={`${progress.requiredDone} of ${progress.required} required tasks done`}
        />
      </Paper>
      {groups.map((g) =>
        g.items.length ? (
          <Stack key={g.title} gap="xs">
            <Title order={2} fz="md">
              {g.title} ({g.items.length})
            </Title>
            {g.items.map((i) => (
              <Paper key={i.task.id} withBorder p="sm">
                <Group justify="space-between" wrap="nowrap">
                  <div style={{ minWidth: 0 }}>
                    <TextLink href={`${base}/tasks/${i.task.id}`} fw={600}>
                      {i.task.title}
                    </TextLink>
                    <Text fz="xs" c="dimmed">
                      {TASK_KIND_LABELS[i.task.kind]} · {EXHIBITOR_REQUIREMENT_LABELS[i.requirement]}
                      {i.deadline ? ` · due ${dateTime(i.deadline)}` : ''}
                    </Text>
                  </div>
                  <Badge variant="light" color={TASK_STATE_LABELS[i.state].color}>
                    {TASK_STATE_LABELS[i.state].label}
                  </Badge>
                </Group>
              </Paper>
            ))}
          </Stack>
        ) : null,
      )}
      {!items.length ? <Text c="dimmed">Nothing to do yet. The show team will add tasks here.</Text> : null}
    </Stack>
  );
}
