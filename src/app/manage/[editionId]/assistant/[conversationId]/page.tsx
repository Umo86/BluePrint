import { notFound } from 'next/navigation';
import { Badge, Group, Paper, Stack, Text } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { TextLink } from '@/components/links';
import { ChatText } from '@/components/chat-text';
import { conversationForStaff } from '@/server/assistant';
import { AppError } from '@/server/errors';
import { dateTime } from '@/lib/format';
import { loadEdition } from '../../load';

export default async function AssistantConversation({ params }: PageProps<'/manage/[editionId]/assistant/[conversationId]'>) {
  const { editionId, conversationId } = await params;
  const { actor, edition } = await loadEdition(editionId, 'helpdesk');
  if (!/^[0-9a-f-]{36}$/i.test(conversationId)) notFound();
  let d: Awaited<ReturnType<typeof conversationForStaff>>;
  try {
    d = await conversationForStaff(actor, conversationId);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
  if (d.conversation.editionId !== edition.id) notFound();
  const base = `/manage/${edition.id}`;
  return (
    <Stack>
      <TextLink href={`${base}/assistant`} fz="sm">
        ← Exhibitor assistant
      </TextLink>
      <PageHeader
        eyebrow="Assistant conversation"
        title={d.who?.companyName ?? 'Exhibitor'}
        description={[d.who?.name || d.who?.email, d.who?.standNumber ? `stand ${d.who.standNumber}` : null].filter(Boolean).join(' · ')}
        actions={
          d.who?.companyId ? (
            <TextLink href={`${base}/exhibitors/${d.who.companyId}`} fz="sm">
              Exhibitor record
            </TextLink>
          ) : null
        }
      />
      <Stack gap="sm" maw={820}>
        {d.messages.map((m) => (
          <Paper key={m.id} withBorder p="md" bg={m.role === 'user' ? 'var(--mantine-color-blue-light)' : undefined}>
            <Group justify="space-between" mb={4}>
              <Text fz="sm" fw={600}>
                {m.role === 'user' ? d.who?.name || 'Exhibitor' : 'Assistant'}
              </Text>
              <Group gap={6}>
                {(m.meta.tools ?? []).length ? (
                  <Text fz="xs" c="dimmed">
                    used {[...new Set(m.meta.tools)].join(', ')}
                  </Text>
                ) : null}
                <Text fz="xs" c="dimmed">
                  {dateTime(m.createdAt)}
                </Text>
              </Group>
            </Group>
            {m.role === 'user' ? (
              <Text fz="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {m.content}
              </Text>
            ) : (
              <ChatText text={m.content} />
            )}
            {(m.meta.proposals ?? []).map((p, i) => (
              <Badge key={i} variant="light" color={p.applied ? 'green' : 'gray'} mt={4}>
                Suggested answers for “{p.taskTitle}”{p.applied ? ': put in the form' : ''}
              </Badge>
            ))}
            {m.meta.ticket ? (
              <Badge variant="light" color={m.meta.ticket.sent ? 'green' : 'gray'} mt={4}>
                Question for the team{m.meta.ticket.sent ? `: sent as ${m.meta.ticket.sent}` : ': not sent'}
              </Badge>
            ) : null}
          </Paper>
        ))}
      </Stack>
    </Stack>
  );
}
