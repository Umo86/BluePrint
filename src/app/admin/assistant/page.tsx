import { Badge, Group, Paper, Stack, Table, TableScrollContainer, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, Title } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { TextLink } from '@/components/links';
import { requireSuperAdmin } from '@/server/auth/current';
import { platformAssistantOverview } from '@/server/assistant/admin';
import { formatUsd, modelLabel } from '@/lib/assistant-pricing';
import { AssistantPlatformForm, ConnectionCheck } from './assistant-admin';

export default async function AdminAssistantPage() {
  const actor = await requireSuperAdmin();
  const d = await platformAssistantOverview(actor);
  return (
    <Stack>
      <PageHeader
        title="AI assistant"
        description="The exhibitor assistant at every show: the connection to Claude, the model and limits, your instructions, and what it costs."
        actions={
          d.settings.assistantEnabled && d.connection !== 'none' ? (
            <Badge size="lg" color="green" variant="light">
              {d.connection === 'practice' ? 'On (practice mode)' : 'On'}
            </Badge>
          ) : (
            <Badge size="lg" color="gray" variant="light">
              Off
            </Badge>
          )
        }
      />

      <Paper withBorder p="md">
        <Title order={2} fz="md" mb={4}>
          Connection to Claude
        </Title>
        <Text fz="sm" mb="sm">
          {d.keySet
            ? `The Claude API key is set (ANTHROPIC_API_KEY). Answers use ${modelLabel(d.settings.assistantModel)}.`
            : d.connection === 'practice'
              ? 'No Claude API key here, so the assistant runs in practice mode: it searches the manual without Claude.'
              : 'No Claude API key is set, so exhibitors do not see the assistant. Add ANTHROPIC_API_KEY in Vercel (Settings, Environment Variables), then redeploy.'}
        </Text>
        <ConnectionCheck disabled={d.connection === 'none'} />
      </Paper>

      <AssistantPlatformForm initial={d.settings} />

      <Paper withBorder p="md">
        <Group justify="space-between" align="flex-end" mb="sm">
          <div>
            <Title order={2} fz="md">
              Usage and costs, last 30 days
            </Title>
            <Text fz="sm" c="dimmed">
              Estimated from the tokens Claude reports, at Anthropic’s list prices. The Claude Console shows the exact bill.
            </Text>
          </div>
          <Text className="bp-figure" fz={28}>
            {formatUsd(d.total.costUsd)}
          </Text>
        </Group>
        {d.editions.length ? (
          <TableScrollContainer minWidth={760}>
            <Table verticalSpacing="xs">
              <TableThead>
                <TableTr>
                  <TableTh>Show</TableTh>
                  <TableTh>Assistant</TableTh>
                  <TableTh ta="right">Questions</TableTh>
                  <TableTh ta="right">People</TableTh>
                  <TableTh ta="right">Test questions</TableTh>
                  <TableTh ta="right">Daily limit</TableTh>
                  <TableTh ta="right">Estimated spend</TableTh>
                </TableTr>
              </TableThead>
              <TableTbody>
                {d.editions.map((e) => (
                  <TableTr key={e.id}>
                    <TableTd>
                      <TextLink href={`/manage/${e.id}/assistant`} fz="sm" fw={600}>
                        {e.name}
                      </TextLink>
                      <Text fz="xs" c="dimmed">
                        {e.showName}
                      </Text>
                    </TableTd>
                    <TableTd>
                      {e.available ? (
                        <Badge color="green" variant="light">
                          On
                        </Badge>
                      ) : (
                        <Badge color="gray" variant="light" title={e.reason ?? undefined}>
                          {e.on ? 'Not open' : 'Off'}
                        </Badge>
                      )}
                      {e.assistantName !== 'Exhibitor assistant' ? (
                        <Text fz="xs" c="dimmed">
                          {e.assistantName}
                        </Text>
                      ) : null}
                    </TableTd>
                    <TableTd ta="right">{e.usage.questions.toLocaleString('en-GB')}</TableTd>
                    <TableTd ta="right">{e.usage.people.toLocaleString('en-GB')}</TableTd>
                    <TableTd ta="right">{e.usage.testQuestions.toLocaleString('en-GB')}</TableTd>
                    <TableTd ta="right">{e.dailyLimit.toLocaleString('en-GB')}</TableTd>
                    <TableTd ta="right">{formatUsd(e.usage.costUsd)}</TableTd>
                  </TableTr>
                ))}
              </TableTbody>
            </Table>
          </TableScrollContainer>
        ) : (
          <Text fz="sm" c="dimmed">
            No shows yet.
          </Text>
        )}
        <Text fz="xs" c="dimmed" mt="sm">
          How long conversations are kept is set in{' '}
          <TextLink href="/admin/settings" fz="xs">
            Platform settings
          </TextLink>{' '}
          (Assistant conversations).
        </Text>
      </Paper>
    </Stack>
  );
}
