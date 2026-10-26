import { Badge, Group, Paper, SimpleGrid, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, Title } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { TextLink } from '@/components/links';
import { ticketsForStand } from '@/server/services/helpdesk';
import { assistantStatus } from '@/server/assistant';
import { dateTime } from '@/lib/format';
import { loadPortal } from '../load';
import { AskTeamForm } from './help-forms';
import { ShowContacts } from '@/components/show-contacts';

const STATUS = {
  open: { label: 'With the show team', color: 'blue' },
  pending: { label: 'Reply from the team', color: 'orange' },
  closed: { label: 'Solved', color: 'gray' },
} as const;

export default async function PortalHelp({ params }: PageProps<'/portal/[slug]/help'>) {
  const { slug } = await params;
  const ctx = await loadPortal(slug);
  const [list, assistant] = await Promise.all([ticketsForStand(ctx.actor, ctx.stand.id), assistantStatus(ctx.edition)]);
  const base = `/portal/${ctx.edition.slug}`;
  return (
    <Stack>
      <PageHeader title="Help" description="Ask the show team a question. You will get an email when they reply, and the conversation stays here." />
      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <Paper withBorder p="md">
          <Title order={2} fz="md" mb="sm">
            Ask the show team
          </Title>
          {assistant.available ? (
            <Text fz="sm" c="dimmed" mb="sm">
              Quick question? The assistant answers from the exhibitor manual straight away:{' '}
              <TextLink href={`${base}/assistant`} fz="sm">
                ask the assistant
              </TextLink>
              .
            </Text>
          ) : null}
          <AskTeamForm slug={ctx.edition.slug} standId={ctx.stand.id} readOnly={ctx.actor.readOnly} />
        </Paper>
        <Stack>
          <Paper withBorder p="md">
            <Title order={2} fz="md" mb="sm">
              Your questions
            </Title>
            {list.length ? (
              <Table verticalSpacing="xs">
                <TableThead>
                  <TableTr>
                    <TableTh>Question</TableTh>
                    <TableTh>Status</TableTh>
                  </TableTr>
                </TableThead>
                <TableTbody>
                  {list.map((t) => (
                    <TableTr key={t.id}>
                      <TableTd>
                        <TextLink href={`${base}/help/${t.id}`} fz="sm" fw={600}>
                          {t.subject}
                        </TextLink>
                        <Text fz="xs" c="dimmed">
                          {t.number} · {dateTime(t.updatedAt)}
                        </Text>
                      </TableTd>
                      <TableTd>
                        <Group gap={4}>
                          <Badge variant="light" color={STATUS[t.status].color}>
                            {STATUS[t.status].label}
                          </Badge>
                        </Group>
                      </TableTd>
                    </TableTr>
                  ))}
                </TableTbody>
              </Table>
            ) : (
              <Text fz="sm" c="dimmed">
                You have not asked anything yet. Colleagues’ questions about this show appear here too.
              </Text>
            )}
          </Paper>
          <ShowContacts contacts={ctx.edition.contacts} title="Or contact the team directly" />
        </Stack>
      </SimpleGrid>
    </Stack>
  );
}
