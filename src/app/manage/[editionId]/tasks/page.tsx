import { Badge, Group, Paper, Progress, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, Tooltip } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { ButtonLink, TextLink } from '@/components/links';
import { listTasks } from '@/server/services/tasks';
import { listExhibitorTypes } from '@/server/services/show-setup';
import { listLibrary } from '@/server/services/library';
import { dateTime } from '@/lib/format';
import { TASK_KIND_LABELS, REQUIREMENT_LABELS } from '@/lib/task-labels';
import { loadEdition } from '../load';
import { FromLibraryButton } from '../manual/manual-controls';
import { TaskRowActions } from './task-controls';

export default async function TasksPage({ params }: PageProps<'/manage/[editionId]/tasks'>) {
  const { editionId } = await params;
  const { actor, edition, access } = await loadEdition(editionId);
  const [rows, types, library] = await Promise.all([listTasks(actor, edition.id), listExhibitorTypes(actor, edition.id), listLibrary(actor, 'task')]);
  const canEdit = access.permissions.has('edit_content');
  const base = `/manage/${edition.id}/tasks`;
  return (
    <Stack>
      <PageHeader
        title="Tasks and forms"
        description="What exhibitors must do before the show, by stand type, with deadlines. Deadlines set as days before build-up move automatically if the dates change."
        actions={
          canEdit ? (
            <Group gap="xs">
              {library.length ? <FromLibraryButton editionId={edition.id} kind="task" items={library.map((l) => ({ value: l.id, label: l.name }))} /> : null}
              <ButtonLink href={`${base}/new`}>New task</ButtonLink>
            </Group>
          ) : null
        }
      />
      <Paper withBorder>
        <Table verticalSpacing="sm">
          <TableThead>
            <TableTr>
              <TableTh>Task</TableTh>
              <TableTh>For</TableTh>
              <TableTh>Deadline</TableTh>
              <TableTh w={200}>Done</TableTh>
              {canEdit ? <TableTh w={110} /> : null}
            </TableTr>
          </TableThead>
          <TableTbody>
            {rows.map((r) => (
              <TableTr key={r.task.id}>
                <TableTd>
                  <Group gap={6}>
                    <TextLink href={`${base}/${r.task.id}`} fw={600} fz="sm">
                      {r.task.title}
                    </TextLink>
                    {!r.task.published ? (
                      <Badge size="xs" color="gray" variant="light">
                        Draft
                      </Badge>
                    ) : null}
                    {r.awaitingReview ? (
                      <Badge size="xs" color="blue">
                        {r.awaitingReview} to review
                      </Badge>
                    ) : null}
                  </Group>
                  <Text fz="xs" c="dimmed">
                    {TASK_KIND_LABELS[r.task.kind]}
                    {r.task.requiresApproval ? ' · needs approval' : ''}
                  </Text>
                </TableTd>
                <TableTd>
                  <Group gap={4}>
                    {types
                      .filter((t) => r.requirements[t.id])
                      .map((t) => (
                        <Tooltip key={t.id} label={REQUIREMENT_LABELS[r.requirements[t.id]]}>
                          <Badge size="sm" variant={r.requirements[t.id] === 'required' ? 'filled' : 'light'} color={t.isSpaceOnly ? 'orange' : 'blue'}>
                            {t.name}
                          </Badge>
                        </Tooltip>
                      ))}
                    {!Object.keys(r.requirements).length ? (
                      <Text fz="xs" c="dimmed">
                        Nobody yet
                      </Text>
                    ) : null}
                  </Group>
                </TableTd>
                <TableTd>
                  <Text fz="sm">{r.deadline ? dateTime(r.deadline) : 'No deadline'}</Text>
                  {r.task.deadlineOffsetDays !== null ? (
                    <Text fz="xs" c="dimmed">
                      {r.task.deadlineOffsetDays} days before build-up
                    </Text>
                  ) : null}
                </TableTd>
                <TableTd>
                  {r.applicable ? (
                    <>
                      <Text fz="xs">
                        {r.done} of {r.applicable} stands
                      </Text>
                      <Progress value={(r.done / r.applicable) * 100} size="sm" />
                    </>
                  ) : (
                    <Text fz="xs" c="dimmed">
                      —
                    </Text>
                  )}
                </TableTd>
                {canEdit ? (
                  <TableTd>
                    <TaskRowActions editionId={edition.id} taskId={r.task.id} title={r.task.title} />
                  </TableTd>
                ) : null}
              </TableTr>
            ))}
          </TableTbody>
        </Table>
        {rows.length === 0 ? (
          <Text p="md" c="dimmed" fz="sm">
            No tasks yet.
          </Text>
        ) : null}
      </Paper>
    </Stack>
  );
}
