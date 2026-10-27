import { notFound } from 'next/navigation';
import { Alert, Badge, Group, Paper, SimpleGrid, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, Title } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { TextLink } from '@/components/links';
import { assistantInsights, testCandidates } from '@/server/assistant';
import { DEFAULT_OFFICE_HOURS } from '@/lib/assistant-config';
import { formatUsd, modelLabel } from '@/lib/assistant-pricing';
import { dateTime, plural } from '@/lib/format';
import { loadEdition } from '../load';
import { FaqEditor, UnansweredList } from './assistant-controls';
import { AssistantSettingsForm } from './assistant-settings-form';
import { AssistantTabs } from './assistant-tabs';
import { TestChat } from './test-chat';

const TABS = ['overview', 'settings', 'knowledge', 'test', 'conversations'] as const;

export default async function AssistantPage({ params, searchParams }: PageProps<'/manage/[editionId]/assistant'>) {
  const { editionId } = await params;
  const sp = await searchParams;
  const { actor, edition, access } = await loadEdition(editionId);
  if (!access.permissions.has('helpdesk') && !access.permissions.has('edit_content')) notFound();
  const d = await assistantInsights(actor, edition.id);
  const people = d.canTest ? await testCandidates(actor, edition.id) : [];
  const base = `/manage/${edition.id}`;
  const canWrite = !actor.readOnly;
  const s = d.settings ?? {};

  const overview = (
    <Stack>
      {!d.status.available ? (
        <Alert color="gray">
          {d.status.reason}{' '}
          {d.status.reason === 'The assistant is switched off for this show.' ? <TextLink href={`${base}/assistant?tab=settings`}>Switch it on in Settings</TextLink> : null}
        </Alert>
      ) : null}
      <SimpleGrid cols={{ base: 2, md: 4 }}>
        <StatCard label="Questions (7 days)" value={d.stats.questions} />
        <StatCard label="People helped (7 days)" value={d.stats.people} />
        <StatCard label="Questions today" value={`${d.today.questions} of ${d.today.limit.toLocaleString('en-GB')}`} hint="Daily limit" />
        <StatCard
          label="Estimated spend (30 days)"
          value={formatUsd(d.month.costUsd)}
          hint={d.month.testQuestions ? `Includes ${plural(d.month.testQuestions, 'test question')}` : modelLabel(d.model)}
        />
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
      <Text fz="xs" c="dimmed">
        In the last 30 days: {plural(d.month.questions, 'question')} from {plural(d.month.people, 'person', 'people')}, {d.month.tokens.inputTokens.toLocaleString('en-GB')} input and{' '}
        {d.month.tokens.outputTokens.toLocaleString('en-GB')} output tokens, {(d.month.tokens.cacheReadTokens ?? 0).toLocaleString('en-GB')} read from the cache. Spend is estimated at Anthropic’s list
        prices; the Claude Console shows the exact bill.
      </Text>
    </Stack>
  );

  const settings = (
    <AssistantSettingsForm
      editionId={edition.id}
      canEdit={d.canEdit}
      platformLimit={d.platform.dailyLimit}
      platformOn={d.platform.enabled}
      timezone={d.edition.timezone}
      now={new Date().toISOString()}
      initial={{
        enabled: d.edition.assistantEnabled,
        name: s.name ?? '',
        greeting: s.greeting ?? '',
        suggestions: s.suggestions ?? [],
        instructions: s.instructions ?? '',
        dailyLimit: typeof s.dailyLimit === 'number' ? s.dailyLimit : null,
        officeHours: s.officeHours ?? DEFAULT_OFFICE_HOURS,
        replyTime: s.replyTime ?? 'same_day',
        askPhone: s.askPhone ?? true,
      }}
    />
  );

  const knowledge = (
    <Stack>
      <Paper withBorder p="md">
        <Title order={2} fz="md" mb={4}>
          What the assistant reads
        </Title>
        <Text fz="sm" c="dimmed" mb="sm">
          It answers only from these, and only shows each exhibitor the pages meant for their type of stand. It also sees that exhibitor’s own checklist, forms and orders.
        </Text>
        <Group gap="xl">
          <div>
            <Text className="bp-figure" fz={28}>
              {d.sources.pages}
            </Text>
            <TextLink href={`${base}/manual`} fz="sm">
              Published manual pages
            </TextLink>
          </div>
          <div>
            <Text className="bp-figure" fz={28}>
              {d.sources.announcements}
            </Text>
            <TextLink href={`${base}/announcements`} fz="sm">
              Announcements
            </TextLink>
          </div>
          <div>
            <Text className="bp-figure" fz={28}>
              {d.sources.faqs}
            </Text>
            <Text fz="sm">Answers you added (below)</Text>
          </div>
        </Group>
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
    </Stack>
  );

  const test = (
    <TestChat
      editionId={edition.id}
      people={people.map((p) => ({ standId: p.standId, userId: p.userId, label: `${p.companyName} · stand ${p.standNumber} · ${p.userName || p.userEmail} (${p.typeName})` }))}
    />
  );

  const conversations = (
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
        Opening a conversation is recorded in the audit log. Conversations are deleted after the retention period set by the super admin. Test chats are not listed.
      </Text>
    </Paper>
  );

  const panels = [
    { value: 'overview', label: 'Overview', badge: d.unanswered.length, content: overview },
    { value: 'settings', label: 'Settings', content: settings },
    { value: 'knowledge', label: 'Knowledge', content: knowledge },
    ...(d.canTest ? [{ value: 'test', label: 'Test chat', content: test }] : []),
    ...(d.canReadChats ? [{ value: 'conversations', label: 'Conversations', content: conversations }] : []),
  ];
  const requested = typeof sp.tab === 'string' ? sp.tab : '';
  const initialTab = (TABS as readonly string[]).includes(requested) && panels.some((p) => p.value === requested) ? requested : 'overview';

  return (
    <Stack>
      <PageHeader
        title="AI assistant"
        description="Answers exhibitors in their portal from your manual, announcements and the answers you add. Set it up, try it out, and fill the gaps in what it knows."
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
      <AssistantTabs panels={panels} initialTab={initialTab} />
    </Stack>
  );
}
