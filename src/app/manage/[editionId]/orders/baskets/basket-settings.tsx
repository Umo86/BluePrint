'use client';

import { useState } from 'react';
import { Button, Group, NumberInput, Paper, Stack, Switch, Text, Title } from '@mantine/core';
import { useAction } from '@/lib/use-action';
import { updateBasketRemindersAction } from '@/app/manage/shop-actions';

type Settings = { enabled: boolean; firstAfterDays: number; secondAfterDays: number };

/** The show's basket reminder settings: on or off, and when the two reminders go. */
export function BasketSettings({ editionId, initial, demo }: { editionId: string; initial: Settings; demo: boolean }) {
  const [v, setV] = useState(initial);
  const save = useAction(updateBasketRemindersAction);
  const changed = JSON.stringify(v) !== JSON.stringify(initial);
  return (
    <Paper withBorder p="md">
      <Stack gap="sm">
        <Title order={2} fz="md">
          Reminder emails
        </Title>
        <Switch
          label="Email exhibitors who leave services in their basket"
          description="The email lists what is in the basket, the total, and the next price rise or ordering deadline. Changing the basket starts the count again; ordering stops the reminders."
          checked={v.enabled}
          onChange={(e) => setV({ ...v, enabled: e.currentTarget.checked })}
        />
        <Group align="flex-start" grow maw={520}>
          <NumberInput
            label="First reminder after"
            description="Days without changes"
            min={1}
            max={14}
            value={v.firstAfterDays}
            onChange={(n) => setV({ ...v, firstAfterDays: Number(n) || 1 })}
            disabled={!v.enabled}
            error={save.fieldErrors.firstAfterDays}
          />
          <NumberInput
            label="Second reminder after"
            description="Days without changes; 0 for none"
            min={0}
            max={30}
            value={v.secondAfterDays}
            onChange={(n) => setV({ ...v, secondAfterDays: Number(n) || 0 })}
            disabled={!v.enabled}
            error={save.fieldErrors.secondAfterDays}
          />
        </Group>
        <Text fz="xs" c="dimmed">
          Reminders go out with the deadline reminders early each morning (7am UK time in winter, 8am in summer), so a basket left today is reminded tomorrow morning. You can reword the email under Emails → Basket reminder.
          {demo ? ' This is a demo show: reminders are kept in its sent emails but never sent.' : ''}
        </Text>
        <Group>
          <Button onClick={() => save.run(editionId, v)} loading={save.pending} disabled={!changed}>
            Save reminder settings
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
