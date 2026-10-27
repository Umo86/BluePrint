'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Badge, Button, Chip, Divider, Grid, Group, NumberInput, Paper, Select, SimpleGrid, Stack, Switch, Text, TextInput, Textarea, Title } from '@mantine/core';
import { TimeInput } from '@mantine/dates';
import { IconRobot } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import {
  ASSISTANT_REPLY_TIMES,
  DEFAULT_ASSISTANT_NAME,
  DEFAULT_SUGGESTIONS,
  REPLY_TIME_LABELS,
  WEEKDAYS,
  greetingText,
  replyExpectation,
  resolveAssistantSettings,
  type AssistantReplyTime,
  type AssistantSettingsInput,
} from '@/lib/assistant-config';
import { ChatText } from '@/components/chat-text';
import { saveAssistantSettingsAction } from '../../assistant-actions';

export type SettingsValues = AssistantSettingsInput;

/** The show's assistant set-up, with a preview of what exhibitors see. */
export function AssistantSettingsForm({
  editionId,
  initial,
  canEdit,
  platformLimit,
  platformOn,
  timezone,
  now,
}: {
  editionId: string;
  initial: SettingsValues;
  canEdit: boolean;
  platformLimit: number;
  platformOn: boolean;
  timezone: string;
  /** The time the page was made, so the preview reads the same on the server and in the browser. */
  now: string;
}) {
  const router = useRouter();
  const [v, setV] = useState<SettingsValues>({ ...initial, suggestions: [0, 1, 2, 3].map((i) => initial.suggestions[i] ?? '') });
  const save = useAction(saveAssistantSettingsAction, { onSuccess: () => router.refresh() });
  const err = (k: string) => save.fieldErrors[k];
  const set = <K extends keyof SettingsValues>(k: K, value: SettingsValues[K]) => setV((x) => ({ ...x, [k]: value }));
  const config = useMemo(() => resolveAssistantSettings({ ...v, suggestions: v.suggestions.filter((s) => s.trim()) }), [v]);
  const ro = !canEdit;

  return (
    <Grid gap="md">
      <Grid.Col span={{ base: 12, lg: 8 }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.run(editionId, { ...v, suggestions: v.suggestions.map((s) => s.trim()).filter(Boolean) });
          }}
        >
          <Stack>
            {!platformOn ? (
              <Alert color="gray">The assistant is switched off for every show by the super admin, so exhibitors do not see it at the moment.</Alert>
            ) : null}
            {ro ? <Alert color="gray">Only people who can edit the show’s content can change these settings.</Alert> : null}
            <Paper withBorder p="md">
              <Stack>
                <Switch
                  label="Assistant on for this show"
                  description="Exhibitors see “Ask the assistant” on every page of their portal once the show is live."
                  checked={v.enabled}
                  onChange={(e) => set('enabled', e.currentTarget.checked)}
                  disabled={ro}
                />
                <TextInput
                  label="Name"
                  description="What exhibitors see it called, such as “BuildExpo helper”. Leave empty for “Exhibitor assistant”."
                  placeholder={DEFAULT_ASSISTANT_NAME}
                  value={v.name}
                  onChange={(e) => set('name', e.currentTarget.value)}
                  maxLength={40}
                  error={err('name')}
                  disabled={ro}
                />
                <Textarea
                  label="Greeting"
                  description="The first message in the chat. Write {first_name} for the exhibitor’s first name. Leave empty for the automatic greeting, which mentions their next deadline."
                  placeholder="Hi {first_name}, I’m here to help you get your stand ready. Ask me anything about the show."
                  value={v.greeting}
                  onChange={(e) => set('greeting', e.currentTarget.value)}
                  autosize
                  minRows={2}
                  maxLength={500}
                  error={err('greeting')}
                  disabled={ro}
                />
                <div>
                  <Text fz="sm" fw={500}>
                    Suggested questions
                  </Text>
                  <Text fz="xs" c="dimmed" mb={6}>
                    Buttons under the greeting. When the exhibitor has a task due, “Help me with …” comes first. Leave them empty for the standard ones.
                  </Text>
                  <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                    {[0, 1, 2, 3].map((i) => (
                      <TextInput
                        key={i}
                        aria-label={`Suggested question ${i + 1}`}
                        placeholder={DEFAULT_SUGGESTIONS[i] ?? 'Another question'}
                        value={v.suggestions[i] ?? ''}
                        onChange={(e) => {
                          const next = [...v.suggestions];
                          next[i] = e.currentTarget.value;
                          set('suggestions', next);
                        }}
                        maxLength={80}
                        error={err(`suggestions.${i}`)}
                        disabled={ro}
                      />
                    ))}
                  </SimpleGrid>
                </div>
                <Textarea
                  label="House rules"
                  description="Your own instructions for this show: the tone to use, things to always or never say, who to contact for what. The assistant follows them within its own rules: it only answers from your manual and never makes things up."
                  placeholder="For anything urgent on site, give the operations team’s number: 020 7946 0101. Call us “the BuildExpo team”."
                  value={v.instructions}
                  onChange={(e) => set('instructions', e.currentTarget.value)}
                  autosize
                  minRows={3}
                  maxRows={12}
                  maxLength={2000}
                  error={err('instructions')}
                  disabled={ro}
                />
                <NumberInput
                  label="Questions per day for this show"
                  description={`A ceiling on cost. Up to ${platformLimit.toLocaleString('en-GB')}, the limit for every show; leave empty to use that.`}
                  value={v.dailyLimit ?? ''}
                  onChange={(n) => set('dailyLimit', n === '' || n === null ? null : Number(n))}
                  min={0}
                  max={platformLimit}
                  allowDecimal={false}
                  thousandSeparator=","
                  w={260}
                  error={err('dailyLimit')}
                  disabled={ro}
                />
              </Stack>
            </Paper>

            <Paper withBorder p="md">
              <Title order={3} fz="md">
                When it cannot answer
              </Title>
              <Text fz="sm" c="dimmed" mb="sm">
                The assistant offers to send the question to your help desk, and tells the exhibitor when to expect a reply.
              </Text>
              <Stack>
                <div>
                  <Text fz="sm" fw={500} id="office-days">
                    Office days
                  </Text>
                  <Chip.Group multiple value={v.officeHours.days.map(String)} onChange={(days) => set('officeHours', { ...v.officeHours, days: days.map(Number).sort() })}>
                    <Group gap={6} mt={6} role="group" aria-labelledby="office-days">
                      {WEEKDAYS.map((d) => (
                        <Chip key={d.value} value={String(d.value)} size="xs" disabled={ro}>
                          {d.short}
                        </Chip>
                      ))}
                    </Group>
                  </Chip.Group>
                </div>
                <Group align="flex-start">
                  <TimeInput label="Opens" value={v.officeHours.start} onChange={(e) => set('officeHours', { ...v.officeHours, start: e.currentTarget.value })} error={err('officeHours.start')} w={140} disabled={ro} />
                  <TimeInput label="Closes" value={v.officeHours.end} onChange={(e) => set('officeHours', { ...v.officeHours, end: e.currentTarget.value })} error={err('officeHours.end')} w={140} disabled={ro} />
                  <Select
                    label="The team usually replies"
                    data={ASSISTANT_REPLY_TIMES.map((r) => ({ value: r, label: REPLY_TIME_LABELS[r] }))}
                    value={v.replyTime}
                    onChange={(x) => x && set('replyTime', x as AssistantReplyTime)}
                    allowDeselect={false}
                    w={300}
                    disabled={ro}
                  />
                </Group>
                <Switch
                  label="Ask for a phone number and a good time to call"
                  description="Shown on the question the assistant prepares for your help desk, filled in from the exhibitor’s profile."
                  checked={v.askPhone}
                  onChange={(e) => set('askPhone', e.currentTarget.checked)}
                  disabled={ro}
                />
              </Stack>
            </Paper>
            {canEdit ? (
              <Group>
                <Button type="submit" loading={save.pending}>
                  Save assistant settings
                </Button>
              </Group>
            ) : null}
          </Stack>
        </form>
      </Grid.Col>

      <Grid.Col span={{ base: 12, lg: 4 }}>
        <Paper withBorder p="md" pos="sticky" top={16}>
          <Group gap={6} mb="xs">
            <IconRobot size={18} aria-hidden />
            <Title order={3} fz="md">
              Preview
            </Title>
            {!v.enabled ? (
              <Badge color="gray" variant="light">
                Off
              </Badge>
            ) : null}
          </Group>
          <Text fz="xs" c="dimmed" mb="sm">
            What an exhibitor called Amira sees when she opens the chat.
          </Text>
          <Text fz="sm" fw={600} mb={6}>
            {config.customName ? config.name : 'Your exhibitor assistant'}
          </Text>
          <Paper p="sm" radius="md" bg="var(--mantine-color-gray-0)" withBorder>
            {config.greeting ? (
              <ChatText text={greetingText(config.greeting, 'Amira')} />
            ) : (
              <Text fz="sm">Hi Amira. Next up is “Health and safety declaration”, due 24 November. Would you like help with it?</Text>
            )}
          </Paper>
          {!config.greeting ? (
            <Text fz="xs" c="dimmed" mt={4}>
              The automatic greeting changes with each exhibitor’s checklist.
            </Text>
          ) : null}
          <Group gap={6} mt="sm">
            {config.suggestions.map((s) => (
              <Badge key={s} variant="light" radius="xl" tt="none" fw={500}>
                {s}
              </Badge>
            ))}
          </Group>
          <Divider my="sm" />
          <Text fz="xs" fw={600}>
            When it passes a question on
          </Text>
          <Text fz="xs" c="dimmed">
            {replyExpectation(config, new Date(now), timezone)}
          </Text>
        </Paper>
      </Grid.Col>
    </Grid>
  );
}
