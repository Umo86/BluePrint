'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Group, NumberInput, Paper, Select, SimpleGrid, Stack, Switch, Text, Textarea, Title } from '@mantine/core';
import { IconPlugConnected } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import type { PlatformSettings } from '@/server/services/settings';
import { checkAssistantConnectionAction, updateSettingsAction } from '../actions';

type AssistantSettings = Pick<
  PlatformSettings,
  'assistantEnabled' | 'assistantModel' | 'assistantEffort' | 'assistantDailyLimit' | 'assistantPersonHourLimit' | 'assistantPersonDayLimit' | 'assistantInstructions'
>;

/** Sends Claude a tiny request with the chosen model and says plainly whether it worked. */
export function ConnectionCheck({ disabled }: { disabled: boolean }) {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const check = useAction(checkAssistantConnectionAction, { onSuccess: (r) => setResult(r ?? null) });
  return (
    <Stack gap="xs">
      <Group>
        <Button variant="default" leftSection={<IconPlugConnected size={16} />} loading={check.pending} onClick={() => check.run()} disabled={disabled}>
          Check the connection
        </Button>
        <Text fz="xs" c="dimmed">
          Sends Claude one tiny question with the model chosen below. It costs a fraction of a penny.
        </Text>
      </Group>
      {result ? (
        <Alert color={result.ok ? 'green' : 'red'} role="status">
          {result.message}
        </Alert>
      ) : null}
    </Stack>
  );
}

/** The assistant's switch, model, effort, limits and the organiser's instructions for every show. */
export function AssistantPlatformForm({ initial }: { initial: AssistantSettings }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const save = useAction(updateSettingsAction, { onSuccess: () => router.refresh() });
  return (
    <Paper withBorder p="md">
      <Title order={2} fz="md">
        Settings for every show
      </Title>
      <Text fz="sm" c="dimmed" mb="sm">
        Each show can switch its assistant off, give it a name, a greeting and its own house rules, and set a lower daily limit, in its AI assistant section.
      </Text>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.run({ ...s });
        }}
      >
        <Stack>
          <Switch
            label="Exhibitor assistant switched on"
            description="Turns the assistant off for every show at once, for example if something goes wrong."
            checked={s.assistantEnabled}
            onChange={(e) => setS({ ...s, assistantEnabled: e.currentTarget.checked })}
          />
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            <Select
              label="Claude model"
              description="Sonnet is the best balance; Haiku is cheapest and fastest; Opus is the most capable and the dearest."
              data={[
                { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (recommended)' },
                { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (lowest cost)' },
                { value: 'claude-opus-5-5', label: 'Claude Opus 5.5 (most capable)' },
              ]}
              value={s.assistantModel}
              onChange={(v) => v && setS({ ...s, assistantModel: v as AssistantSettings['assistantModel'] })}
              allowDeselect={false}
            />
            <Select
              label="Effort"
              description="How much thought goes into each answer. Low answers fastest and costs least."
              data={[
                { value: 'low', label: 'Low (recommended for chat)' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
              ]}
              value={s.assistantEffort}
              onChange={(v) => v && setS({ ...s, assistantEffort: v as AssistantSettings['assistantEffort'] })}
              allowDeselect={false}
            />
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, md: 3 }}>
            <NumberInput
              label="Questions per show per day"
              description="A ceiling on cost. Shows can set a lower one."
              value={s.assistantDailyLimit}
              onChange={(v) => setS({ ...s, assistantDailyLimit: Number(v || 0) })}
              min={0}
              max={100000}
              allowDecimal={false}
              thousandSeparator=","
              error={save.fieldErrors.assistantDailyLimit}
            />
            <NumberInput
              label="Questions per person per hour"
              value={s.assistantPersonHourLimit}
              onChange={(v) => setS({ ...s, assistantPersonHourLimit: Number(v || 1) })}
              min={1}
              max={1000}
              allowDecimal={false}
              error={save.fieldErrors.assistantPersonHourLimit}
            />
            <NumberInput
              label="Questions per person per day"
              value={s.assistantPersonDayLimit}
              onChange={(v) => setS({ ...s, assistantPersonDayLimit: Number(v || 1) })}
              min={1}
              max={5000}
              allowDecimal={false}
              error={save.fieldErrors.assistantPersonDayLimit}
            />
          </SimpleGrid>
          <Textarea
            label="Instructions for every show"
            description="Your organisation’s own rules for the assistant at all your shows, such as how to refer to you or what never to promise. Each show can add its own. The assistant follows them within its built-in rules."
            placeholder="Refer to us as the organiser. Never promise refunds or discounts: pass those questions to the show team."
            value={s.assistantInstructions}
            onChange={(e) => setS({ ...s, assistantInstructions: e.currentTarget.value })}
            autosize
            minRows={3}
            maxRows={12}
            maxLength={2000}
            error={save.fieldErrors.assistantInstructions}
          />
          <Group>
            <Button type="submit" loading={save.pending}>
              Save
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  );
}
