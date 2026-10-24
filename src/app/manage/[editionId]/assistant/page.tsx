import { notFound } from 'next/navigation';
import { Alert, Badge, Paper, SimpleGrid, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, Title } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { TextLink } from '@/components/links';
import { assistantInsights } from '@/server/assistant';
import { dateTime, plural } from '@/lib/format';
import { loadEdition } from '../load';
import { FaqEditor, UnansweredList } from './assistant-controls';

export default async function AssistantPage({ params }: PageProps<'/manage/[editionId]/assistant'>) {
  const { editionId } = await params;
  const { actor, edition, access } = await loadEdition(editionId);
  if (!access.permissions.has('helpdesk') && !access.permissions.has('edit_content')) notFound();
  const d = await assistantInsights(actor, edition.id);
  const base = `/manage/${edition.id}`;
  const canWrite = !actor.readOnly;
  return (
    <Stack>
      <PageHeader
        title="Exhibitor assistant"
        description="The assistant answers exhibitors in the portal from your manual pages, announcements and the answers you add here. Questions it could not answer appear below so you can fill the gaps."
        actions={
          d.status.available ? (
            <Badge size="lg" color="green" variant="light">
              {d.status.kind === 'offline' ? 'On (practice mode)' : 'On'}
            </Badge>
          ) : (
            <Badge size="lg" color="gray" variant="light">
              Off
            </Badge>
          )
        }
      />
      {!d.status.available ? (
        <Alert color="gray">
          {d.status.reason} {access.role === 'super_admin' || access.role === 'show_admin' ? <TextLink href={`${base}/settings`}>Show settings</TextLink> : null}
        </Alert>
      ) : null}
      <SimpleGrid cols={{ base: 2, md: 4 }}>
        <StatCard label="Questions (7 days)" value={d.stats.questions} />
        <StatCard label="People helped (7 days)" value={d.stats.people} />
        <StatCard label="Conversations (7 days)" value={d.stats.conversations} />
        <StatCard label="Not answered yet" value={d.unanswered.length} hint="Below" />
      </SimpleGrid>

      <Paper withBorder p="md">
        <Title order={2} fz="md" mb={4}>
          Questions it could not answer
        </Title>
        <Text fz="sm" c="dimmed" mb="sm">
          Add an answer and the assistant uses it from now on, or update the manual and mark the question as dealt with.
        </Text>
        <UnansweredList editionId={edition.id} items={d.unanswered.map((u) => ({ id: u.id, question: u.question, at: dateTime(u.createdAt) }))} canWrite={canWrite} />
      </Paper>

      <Paper withBorder p="md">
        <Title order={2} fz="md" mb={4}>
          Answers for the assistant
        </Title>
        <Text fz="sm" c="dimmed" mb="sm">
          Short questions and answers the assistant can use, alongside the manual. {plural(d.faqs.length, 'answer')} so far.
        </Text>
        <FaqEditor editionId={edition.id} faqs={d.faqs.map((f) => ({ id: f.id, question: f.question, answer: f.answer }))} canWrite={canWrite} />
      </Paper>

      {d.canReadChats ? (
        <Paper withBorder p="md">
          <Title order={2} fz="md" mb="sm">
            Recent conversations
          </Title>
          {d.conversations.length ? (
            <Table verticalSpacing="xs">
              <TableThead>
                <TableTr>
                  <TableTh>Exhibitor</TableTh>
                  <TableTh>Person</TableTh>
                  <TableTh>Messages</TableTh>
                  <TableTh>Last message</TableTh>
                </TableTr>
              </TableThead>
              <TableTbody>
                {d.conversations.map((c) => (
                  <TableTr key={c.id}>
                    <TableTd>
                      <TextLink href={`${base}/assistant/${c.id}`} fz="sm" fw={600}>
                        {c.companyName ?? 'Exhibitor'}
                      </TextLink>
                      {c.standNumber ? (
                        <Text fz="xs" c="dimmed">
                          Stand {c.standNumber}
                        </Text>
                      ) : null}
                    </TableTd>
                    <TableTd>
                      <Text fz="sm">{c.userName || c.userEmail}</Text>
                    </TableTd>
                    <TableTd>{c.messages}</TableTd>
                    <TableTd>{dateTime(c.updatedAt)}</TableTd>
                  </TableTr>
                ))}
              </TableTbody>
            </Table>
          ) : (
            <Text fz="sm" c="dimmed">
              No conversations yet.
            </Text>
          )}
          <Text fz="xs" c="dimmed" mt="sm">
            Opening a conversation is recorded in the audit log. Conversations are deleted after the retention period set by the super admin.
          </Text>
        </Paper>
      ) : null}
    </Stack>
  );
}
