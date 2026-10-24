import { notFound } from 'next/navigation';
import { Stack } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { getTask } from '@/server/services/tasks';
import { listPages } from '@/server/services/manual';
import { listExhibitorTypes } from '@/server/services/show-setup';
import { responsesForTask } from '@/server/services/submissions';
import { AppError } from '@/server/errors';
import { toLocalDateTimeString } from '@/lib/dates';
import { loadEdition } from '../../load';
import { TaskEditor } from './task-editor';

export default async function TaskPage({ params, searchParams }: PageProps<'/manage/[editionId]/tasks/[taskId]'>) {
  const { editionId, taskId } = await params;
  const { actor, edition, access } = await loadEdition(editionId);
  const sp = await searchParams;
  const isNew = taskId === 'new';
  if (isNew && !access.permissions.has('edit_content')) notFound();
  if (!isNew && !/^[0-9a-f-]{36}$/i.test(taskId)) notFound();
  let loaded: Awaited<ReturnType<typeof getTask>> | null = null;
  if (!isNew) {
    try {
      loaded = await getTask(actor, taskId);
    } catch (err) {
      if (err instanceof AppError) notFound();
      throw err;
    }
    if (loaded.task.editionId !== edition.id) notFound();
  }
  const [types, pages, responses] = await Promise.all([
    listExhibitorTypes(actor, edition.id),
    listPages(actor, edition.id),
    loaded ? responsesForTask(actor, loaded.task.id) : Promise.resolve(null),
  ]);
  const t = loaded?.task;
  const requirements = Object.fromEntries(types.map((ty) => [ty.id, loaded?.requirements[ty.id] ?? (isNew ? 'required' : 'hidden')])) as Record<
    string,
    'required' | 'if_applicable' | 'optional' | 'hidden'
  >;
  return (
    <Stack>
      <PageHeader eyebrow="Tasks and forms" title={t ? t.title : 'New task'} />
      <TaskEditor
        editionId={edition.id}
        taskId={t?.id ?? null}
        canEdit={access.permissions.has('edit_content')}
        canReview={access.permissions.has('manage_exhibitors')}
        canExport={access.permissions.has('manage_exhibitors') || access.permissions.has('view_reports')}
        canSaveToLibrary={actor.isSuperAdmin && !actor.readOnly}
        initialTab={typeof sp.tab === 'string' ? sp.tab : undefined}
        initial={{
          title: t?.title ?? '',
          descriptionHtml: t?.descriptionHtml ?? '',
          kind: t?.kind ?? 'form',
          formSchema: t?.formSchema ?? [],
          deadline:
            t?.deadlineAt
              ? { mode: 'fixed', at: toLocalDateTimeString(t.deadlineAt) ?? '' }
              : t?.deadlineOffsetDays !== null && t?.deadlineOffsetDays !== undefined
                ? { mode: 'offset', offsetDays: t.deadlineOffsetDays }
                : isNew
                  ? { mode: 'offset', offsetDays: 21 }
                  : { mode: 'none' },
          requiresApproval: t?.requiresApproval ?? false,
          locksAtDeadline: t?.locksAtDeadline ?? true,
          linkedPageId: t?.linkedPageId ?? null,
          linkedCategoryId: t?.linkedCategoryId ?? null,
          reminderOffsets: t?.reminderOffsets ?? null,
          published: t?.published ?? false,
          requirements,
        }}
        types={types.map((ty) => ({ id: ty.id, name: ty.name, isSpaceOnly: ty.isSpaceOnly, standCount: ty.standCount }))}
        pages={pages.map((p) => ({ value: p.id, label: p.title }))}
        buildUpStartsAt={edition.buildUpStartsAt?.toISOString() ?? null}
        responses={
          responses
            ? responses.rows.map((r) => ({
                standId: r.stand.id,
                standNumber: r.stand.number,
                companyName: r.company?.name ?? 'No company',
                requirement: r.requirement,
                state: r.state,
                submittedAt: r.submission?.submittedAt?.toISOString() ?? null,
                late: r.late,
                deadline: r.deadline?.toISOString() ?? null,
              }))
            : []
        }
      />
    </Stack>
  );
}
