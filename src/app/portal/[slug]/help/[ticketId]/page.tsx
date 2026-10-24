import { notFound } from 'next/navigation';
import { Badge, Group, Paper, Stack, Text } from '@mantine/core';
import { IconPaperclip } from '@tabler/icons-react';
import { PageHeader } from '@/components/ui/page-header';
import { TextLink } from '@/components/links';
import { ticketForExhibitor } from '@/server/services/helpdesk';
import { AppError } from '@/server/errors';
import { dateTime } from '@/lib/format';
import { loadPortal } from '../../load';
import { ReplyForm } from '../help-forms';

const STATUS = {
  open: { label: 'With the show team', color: 'blue' },
  pending: { label: 'Reply from the team', color: 'orange' },
  closed: { label: 'Solved', color: 'gray' },
} as const;

export default async function PortalTicket({ params }: PageProps<'/portal/[slug]/help/[ticketId]'>) {
  const { slug, ticketId } = await params;
  const ctx = await loadPortal(slug);
  if (!/^[0-9a-f-]{36}$/i.test(ticketId)) notFound();
  let data: Awaited<ReturnType<typeof ticketForExhibitor>>;
  try {
    data = await ticketForExhibitor(ctx.actor, ctx.stand.id, ticketId);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
  const { ticket, messages } = data;
  return (
    <Stack>
      <TextLink href={`/portal/${ctx.edition.slug}/help`} fz="sm">
        ← Help
      </TextLink>
      <PageHeader
        eyebrow={ticket.number ?? 'Question'}
        title={ticket.subject}
        actions={
          <Badge size="lg" variant="light" color={STATUS[ticket.status].color}>
            {STATUS[ticket.status].label}
          </Badge>
        }
      />
      <Stack gap="sm" maw={820}>
        {messages.map((m) => (
          <Paper key={m.id} withBorder p="md" bg={m.fromTeam ? 'var(--mantine-color-blue-light)' : undefined}>
            <Group justify="space-between" mb={4}>
              <Text fz="sm" fw={600}>
                {m.fromTeam ? `${m.authorName || 'The show team'} (show team)` : m.authorName || 'You'}
              </Text>
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
        <Paper withBorder p="md">
          <ReplyForm slug={ctx.edition.slug} standId={ctx.stand.id} ticketId={ticket.id} closed={ticket.status === 'closed'} readOnly={ctx.actor.readOnly} />
        </Paper>
      </Stack>
    </Stack>
  );
}
