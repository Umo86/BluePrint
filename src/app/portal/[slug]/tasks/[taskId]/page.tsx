import { notFound } from 'next/navigation';
import { Alert, Badge, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { ButtonLink, TextLink } from '@/components/links';
import { RichHtml } from '@/components/rich-html';
import { taskForStand } from '@/server/services/submissions';
import { AppError } from '@/server/errors';
import { dateTime } from '@/lib/format';
import { EXHIBITOR_REQUIREMENT_LABELS, TASK_STATE_LABELS } from '@/lib/task-labels';
import { loadPortal } from '../../load';
import { TaskForm, TaskMarkButtons } from './task-form';

export default async function TaskPage({ params }: PageProps<'/portal/[slug]/tasks/[taskId]'>) {
  const { slug, taskId } = await params;
  const ctx = await loadPortal(slug);
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) notFound();
  let t: Awaited<ReturnType<typeof taskForStand>>;
  try {
    t = await taskForStand(ctx.actor, ctx.stand.id, taskId);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
  const base = `/portal/${ctx.edition.slug}`;
  const editable = t.editable && ctx.editable;
  const hasForm = ['form', 'upload', 'declaration'].includes(t.task.kind);
  return (
    <Stack maw={860}>
      <TextLink href={`${base}/checklist`} fz="sm">
        ← Your checklist
      </TextLink>
      <div>
        <Group gap="xs">
          <Title order={1} fz={30}>
            {t.task.title}
          </Title>
          <Badge variant="light" color={TASK_STATE_LABELS[t.state].color}>
            {TASK_STATE_LABELS[t.state].label}
          </Badge>
        </Group>
        <Text c="dimmed" fz="sm">
          {EXHIBITOR_REQUIREMENT_LABELS[t.requirement]}
          {t.deadline ? ` · deadline ${dateTime(t.deadline)}` : ''}
          {t.submission?.submittedAt ? ` · last sent ${dateTime(t.submission.submittedAt)}` : ''}
        </Text>
      </div>
      {t.submission?.reviewNote && ['changes_needed', 'rejected', 'approved'].includes(t.submission.status) ? (
        <Alert color={t.submission.status === 'approved' ? 'green' : 'orange'} title={t.submission.status === 'approved' ? 'Note from the show team' : 'The show team needs changes'}>
          {t.submission.reviewNote}
        </Alert>
      ) : null}
      {t.lockedReason || ctx.closedReason ? <Alert color="gray">{ctx.closedReason ?? t.lockedReason}</Alert> : null}
      {t.task.descriptionHtml ? (
        <Paper withBorder p="md">
          <RichHtml html={t.task.descriptionHtml} />
        </Paper>
      ) : null}
      {t.page ? (
        <Text fz="sm">
          More information: <TextLink href={`${base}/manual/${t.page.slug}`}>{t.page.title}</TextLink>
        </Text>
      ) : null}
      {hasForm ? (
        <Paper withBorder p="md">
          <TaskForm
            slug={ctx.edition.slug}
            standId={ctx.stand.id}
            taskId={t.task.id}
            fields={t.task.formSchema}
            initial={t.submission?.data ?? {}}
            files={t.files}
            editable={editable}
            alreadySent={Boolean(t.submission && t.submission.status !== 'draft' && t.submission.status !== 'changes_needed')}
            requiresApproval={t.task.requiresApproval}
          />
        </Paper>
      ) : null}
      {t.task.kind === 'info' ? (
        <TaskMarkButtons slug={ctx.edition.slug} standId={ctx.stand.id} taskId={t.task.id} mode="info" done={t.state === 'completed'} editable={editable} />
      ) : null}
      {t.task.kind === 'order' ? (
        <Alert color="blue">
          <Stack gap="xs">
            <Text fz="sm">Order the services you need from the shop. This task is completed as soon as your order is paid (or placed on invoice).</Text>
            <Group>
              <ButtonLink href={`/portal/${ctx.edition.slug}/shop`} size="xs">
                Go to the shop
              </ButtonLink>
            </Group>
          </Stack>
        </Alert>
      ) : null}
      {t.task.kind === 'contractor_nomination' || t.task.kind === 'space_only_pack' ? (
        <Alert color="blue">
          This is done on your <TextLink href={`${base}/space-only`}>stand approval page</TextLink>, where you nominate your contractor and send your stand pack.
        </Alert>
      ) : null}
      {t.requirement !== 'required' && !t.done && t.task.kind !== 'info' ? (
        <TaskMarkButtons slug={ctx.edition.slug} standId={ctx.stand.id} taskId={t.task.id} mode="not_needed" done={false} editable={editable} />
      ) : null}
      {t.state === 'not_needed' ? <TaskMarkButtons slug={ctx.edition.slug} standId={ctx.stand.id} taskId={t.task.id} mode="undo" done editable={editable} /> : null}
    </Stack>
  );
}
