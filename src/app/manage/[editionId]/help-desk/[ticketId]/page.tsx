import { notFound } from 'next/navigation';
import { Badge, Grid, GridCol, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { IconLock, IconPaperclip } from '@tabler/icons-react';
import { PageHeader } from '@/components/ui/page-header';
import { TextLink } from '@/components/links';
import { ticketForStaff } from '@/server/services/helpdesk';
import { AppError } from '@/server/errors';
import { dateTime } from '@/lib/format';
import { loadEdition } from '../../load';
import { AssignControl, StaffReplyForm, StatusControl } from './ticket-controls';

const STATUS = {
  open: { label: 'Waiting for the team', color: 'blue' },
  pending: { label: 'Waiting for the exhibitor', color: 'orange' },
  closed: { label: 'Closed', color: 'gray' },
} as const;

export default async function StaffTicket({ params }: PageProps<'/manage/[editionId]/help-desk/[ticketId]'>) {
  const { editionId, ticketId } = await params;
  const { actor, edition } = await loadEdition(editionId, 'helpdesk');
  if (!/^[0-9a-f-]{36}$/i.test(ticketId)) notFound();
  let d: Awaited<ReturnType<typeof ticketForStaff>>;
  try {
    d = await ticketForStaff(actor, ticketId);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
  if (d.ticket.editionId !== edition.id) notFound();
  const t = d.ticket;
  const base = `/manage/${edition.id}`;
  const canWrite = !actor.readOnly;
  return (
    <Stack>
      <TextLink href={`${base}/help-desk`} fz="sm">
        ← Help desk
      </TextLink>
      <PageHeader
        eyebrow={t.number ?? 'Question'}
        title={t.subject}
        actions={
          <Badge size="lg" variant="light" color={STATUS[t.status].color}>
            {STATUS[t.status].label}
          </Badge>
        }
      />
      <Grid>
        <GridCol span={{ base: 12, lg: 8 }}>
          <Stack gap="sm">
            {d.messages.map((m) => (
              <Paper
                key={m.id}
                withBorder
                p="md"
                bg={m.internal ? 'var(--mantine-color-yellow-light)' : m.fromExhibitor ? undefined : 'var(--mantine-color-blue-light)'}
              >
                <Group justify="space-between" mb={4}>
                  <Group gap={6}>
                    <Text fz="sm" fw={600}>
                      {m.authorName}
                    </Text>
                    {m.internal ? (
                      <Badge size="xs" color="yellow" leftSection={<IconLock size={10} />}>
                        Internal note
                      </Badge>
                    ) : m.fromExhibitor ? (
                      <Badge size="xs" variant="light" color="gray">
                        Exhibitor
                      </Badge>
                    ) : (
                      <Badge size="xs" variant="light" color="blue">
                        Show team
                      </Badge>
                    )}
                  </Group>
                  <Text fz="xs" c="dimmed">
                    {dateTime(m.createdAt)}
                  </Text>
                </Group>
                <Text fz="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {m.body}
                </Text>
                {m.files.length ? (
                  <Stack gap={2} mt="xs">
                    {m.files.map((f) => (
                      <Group key={f.id} gap={4}>
                        <IconPaperclip size={14} />
                        <TextLink href={`/files/${f.id}`} fz="sm">
                          {f.name}
                        </TextLink>
                      </Group>
                    ))}
                  </Stack>
                ) : null}
              </Paper>
            ))}
            {canWrite ? (
              <Paper withBorder p="md">
                <StaffReplyForm editionId={edition.id} ticketId={t.id} standId={t.standId} savedReplies={d.savedReplies.map((r) => ({ id: r.id, title: r.title, body: r.body }))} />
              </Paper>
            ) : null}
          </Stack>
        </GridCol>
        <GridCol span={{ base: 12, lg: 4 }}>
          <Stack>
            <Paper withBorder p="md">
              <Title order={2} fz="sm" mb="xs">
                Exhibitor
              </Title>
              {d.company ? (
                <TextLink href={`${base}/exhibitors/${d.company.id}`} fz="sm" fw={600}>
                  {d.company.name}
                </TextLink>
              ) : null}
              {d.stand ? (
                <Text fz="sm" c="dimmed">
                  Stand {d.stand.number}
                </Text>
              ) : null}
              <Text fz="sm" mt="xs">
                {t.contactName}
              </Text>
              <Text fz="sm">{t.contactEmail}</Text>
              {t.contactPhone ? <Text fz="sm">{t.contactPhone}</Text> : null}
              <Text fz="xs" c="dimmed" mt="xs">
                Asked {dateTime(t.createdAt)} {t.source === 'assistant' ? 'via the assistant' : t.source === 'staff' ? 'by the team' : 'in the portal'}
              </Text>
            </Paper>
            <Paper withBorder p="md">
              <Stack gap="sm">
                <AssignControl editionId={edition.id} ticketId={t.id} assignedTo={t.assignedTo} team={d.team} disabled={!canWrite} />
                <StatusControl editionId={edition.id} ticketId={t.id} status={t.status} disabled={!canWrite} />
              </Stack>
            </Paper>
          </Stack>
        </GridCol>
      </Grid>
    </Stack>
  );
}
