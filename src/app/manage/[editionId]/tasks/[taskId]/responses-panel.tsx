'use client';

import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Drawer,
  Group,
  Loader,
  Paper,
  ScrollArea,
  SegmentedControl,
  Stack,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { IconSearch } from '@tabler/icons-react';
import { FormRenderer, type FileInfo } from '@/components/form-renderer';
import { useAction } from '@/lib/use-action';
import { TASK_STATE_LABELS, REQUIREMENT_LABELS } from '@/lib/task-labels';
import type { FormField } from '@/lib/forms';
import { extendDeadlineAction, reopenSubmissionAction, reviewSubmissionAction, submissionDetailAction } from '../../../actions';

export type ResponseRow = {
  standId: string;
  standNumber: string;
  companyName: string;
  requirement: string;
  state: string;
  submittedAt: string | null;
  late: boolean;
  deadline: string | null;
};

type Detail = {
  submission: {
    status: string;
    data: Record<string, unknown>;
    version: number;
    submittedAt: string | null;
    reviewNote: string | null;
    reopenedUntil: string | null;
    deadlineOverrideAt: string | null;
  } | null;
  submitter: { name: string; email: string } | null;
  files: FileInfo;
};

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }) : '—');

export function ResponsesPanel({
  editionId,
  taskId,
  rows,
  fields,
  canReview,
  canExport,
  requiresApproval,
}: {
  editionId: string;
  taskId: string;
  rows: ResponseRow[];
  fields: FormField[];
  canReview: boolean;
  canExport: boolean;
  requiresApproval: boolean;
}) {
  const [filter, setFilter] = useState<'all' | 'todo' | 'review' | 'done'>(requiresApproval ? 'review' : 'all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<ResponseRow | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [note, setNote] = useState('');
  const [reopenUntil, setReopenUntil] = useState<string | null>(null);
  const [extendTo, setExtendTo] = useState<string | null>(null);
  const load = useAction(submissionDetailAction, { notifyErrors: true, onSuccess: (d) => setDetail((d as Detail) ?? null) });
  const review = useAction(reviewSubmissionAction, { onSuccess: () => setOpen(null) });
  const reopen = useAction(reopenSubmissionAction, { onSuccess: () => setOpen(null) });
  const extend = useAction(extendDeadlineAction, { onSuccess: () => setOpen(null) });

  const shown = useMemo(() => {
    let r = rows;
    if (filter === 'todo') r = r.filter((x) => ['to_do', 'overdue', 'draft', 'changes_needed'].includes(x.state));
    if (filter === 'review') r = r.filter((x) => x.state === 'submitted');
    if (filter === 'done') r = r.filter((x) => ['completed', 'approved', 'not_needed'].includes(x.state));
    const term = q.trim().toLowerCase();
    if (term) r = r.filter((x) => x.companyName.toLowerCase().includes(term) || x.standNumber.toLowerCase().includes(term));
    return r;
  }, [rows, filter, q]);

  const openRow = (r: ResponseRow) => {
    setOpen(r);
    setDetail(null);
    setNote('');
    setReopenUntil(null);
    setExtendTo(null);
    load.run(taskId, r.standId);
  };

  const counts = {
    review: rows.filter((x) => x.state === 'submitted').length,
    todo: rows.filter((x) => ['to_do', 'overdue', 'draft', 'changes_needed'].includes(x.state)).length,
    done: rows.filter((x) => ['completed', 'approved', 'not_needed'].includes(x.state)).length,
  };

  return (
    <Stack>
      <Group justify="space-between">
        <Group gap="sm">
          <SegmentedControl
            value={filter}
            onChange={(f) => setFilter(f as typeof filter)}
            data={[
              { value: 'all', label: `All (${rows.length})` },
              { value: 'review', label: `To review (${counts.review})` },
              { value: 'todo', label: `Not done (${counts.todo})` },
              { value: 'done', label: `Done (${counts.done})` },
            ]}
          />
          <TextInput aria-label="Find a stand" placeholder="Company or stand" leftSection={<IconSearch size={16} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} w={220} />
        </Group>
        {canExport ? (
          <Button component="a" href={`/manage/${editionId}/tasks/${taskId}/export`} variant="default">
            Download CSV
          </Button>
        ) : null}
      </Group>
      <Paper withBorder>
        <Table verticalSpacing="xs" highlightOnHover>
          <TableThead>
            <TableTr>
              <TableTh>Stand</TableTh>
              <TableTh>Company</TableTh>
              <TableTh>Status</TableTh>
              <TableTh>Sent</TableTh>
              <TableTh />
            </TableTr>
          </TableThead>
          <TableTbody>
            {shown.map((r) => (
              <TableTr key={r.standId}>
                <TableTd fw={600}>{r.standNumber}</TableTd>
                <TableTd>
                  {r.companyName}
                  <Text fz="xs" c="dimmed">
                    {REQUIREMENT_LABELS[r.requirement]}
                  </Text>
                </TableTd>
                <TableTd>
                  <Badge variant="light" color={TASK_STATE_LABELS[r.state]?.color ?? 'gray'}>
                    {TASK_STATE_LABELS[r.state]?.label ?? r.state}
                  </Badge>
                  {r.late ? (
                    <Badge ml={4} variant="outline" color="red" size="sm">
                      Late
                    </Badge>
                  ) : null}
                </TableTd>
                <TableTd>{fmt(r.submittedAt)}</TableTd>
                <TableTd>
                  <Button size="compact-xs" variant="light" onClick={() => openRow(r)}>
                    Open
                  </Button>
                </TableTd>
              </TableTr>
            ))}
          </TableTbody>
        </Table>
        {shown.length === 0 ? (
          <Text p="md" fz="sm" c="dimmed">
            Nothing here.
          </Text>
        ) : null}
      </Paper>

      <Drawer opened={Boolean(open)} onClose={() => setOpen(null)} position="right" size="xl" title={open ? `Stand ${open.standNumber} · ${open.companyName}` : ''} scrollAreaComponent={ScrollArea.Autosize}>
        {!detail ? (
          <Loader />
        ) : (
          <Stack>
            <Group gap="xs">
              <Badge variant="light" color={TASK_STATE_LABELS[open?.state ?? '']?.color ?? 'gray'}>
                {TASK_STATE_LABELS[open?.state ?? '']?.label ?? open?.state}
              </Badge>
              {detail.submission?.submittedAt ? (
                <Text fz="sm" c="dimmed">
                  Sent {fmt(detail.submission.submittedAt)}
                  {detail.submitter ? ` by ${detail.submitter.name || detail.submitter.email}` : ''} · version {detail.submission.version}
                </Text>
              ) : null}
            </Group>
            {detail.submission?.reviewNote ? (
              <Alert color="gray" title="Last note to the exhibitor">
                {detail.submission.reviewNote}
              </Alert>
            ) : null}
            {detail.submission && Object.keys(detail.submission.data).length ? (
              <Paper withBorder p="md">
                <FormRenderer fields={fields} value={detail.submission.data} files={detail.files} readOnly />
              </Paper>
            ) : (
              <Text fz="sm" c="dimmed">
                No answers yet.
              </Text>
            )}
            {canReview && open ? (
              <Paper withBorder p="md">
                <Stack gap="sm">
                  <Text fw={600} fz="sm">
                    Decision
                  </Text>
                  <Textarea label="Note to the exhibitor" description="Needed when you ask for changes or do not accept it. They get it by email." autosize minRows={2} value={note} onChange={(e) => setNote(e.currentTarget.value)} error={review.fieldErrors.note} />
                  <Group gap="xs">
                    {requiresApproval ? (
                      <Button color="green" loading={review.pending} onClick={() => review.run(editionId, taskId, open.standId, 'approved', note || null)} disabled={!detail.submission}>
                        Approve
                      </Button>
                    ) : (
                      <Button color="green" variant="light" loading={review.pending} onClick={() => review.run(editionId, taskId, open.standId, 'completed', note || null)}>
                        Mark as done
                      </Button>
                    )}
                    <Button color="orange" variant="light" loading={review.pending} onClick={() => review.run(editionId, taskId, open.standId, 'changes_needed', note)}>
                      Ask for changes
                    </Button>
                    <Button color="red" variant="subtle" loading={review.pending} onClick={() => review.run(editionId, taskId, open.standId, 'rejected', note)}>
                      Do not accept
                    </Button>
                    <Button color="gray" variant="subtle" loading={review.pending} onClick={() => review.run(editionId, taskId, open.standId, 'not_needed', note || null)}>
                      Not needed for this stand
                    </Button>
                  </Group>
                </Stack>
              </Paper>
            ) : null}
            {canReview && open ? (
              <Paper withBorder p="md">
                <Stack gap="sm">
                  <Text fw={600} fz="sm">
                    More time
                  </Text>
                  <Text fz="xs" c="dimmed">
                    Deadline for this stand: {fmt(detail.submission?.deadlineOverrideAt ?? open.deadline)}
                    {detail.submission?.reopenedUntil ? ` · reopened until ${fmt(detail.submission.reopenedUntil)}` : ''}
                  </Text>
                  <Group align="flex-end" gap="xs">
                    <DateTimePicker label="New deadline for this stand" value={extendTo} onChange={setExtendTo} w={240} />
                    <Button variant="light" disabled={!extendTo} loading={extend.pending} onClick={() => extend.run(editionId, taskId, open.standId, extendTo)}>
                      Extend
                    </Button>
                    {detail.submission?.deadlineOverrideAt ? (
                      <Button variant="subtle" loading={extend.pending} onClick={() => extend.run(editionId, taskId, open.standId, null)}>
                        Use the normal deadline
                      </Button>
                    ) : null}
                  </Group>
                  <Group align="flex-end" gap="xs">
                    <DateTimePicker label="Let them change their answers until" value={reopenUntil} onChange={setReopenUntil} w={240} />
                    <Button variant="light" disabled={!reopenUntil} loading={reopen.pending} onClick={() => reopenUntil && reopen.run(editionId, taskId, open.standId, reopenUntil)}>
                      Reopen
                    </Button>
                  </Group>
                </Stack>
              </Paper>
            ) : null}
          </Stack>
        )}
      </Drawer>
    </Stack>
  );
}
