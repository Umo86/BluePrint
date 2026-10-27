'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Group, Paper, Stack, Text, TextInput, Title } from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconRefresh, IconTrash } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import { removeDemoDataAction, resetDemoDataAction } from '../actions';

const CONFIRMATION = 'remove demo data';

/** Adds a fresh copy of the demo data (removing the current one first, if there is one). */
export function ResetDemo({ mode }: { mode: 'loaded' | 'removed' | 'none' }) {
  const router = useRouter();
  const reset = useAction(resetDemoDataAction, { onSuccess: () => router.refresh() });
  const label = mode === 'loaded' ? 'Start the demo again' : 'Add the demo data';
  return (
    <Paper withBorder p="md">
      <Stack gap="sm">
        <Title order={2} fz="md">
          {label}
        </Title>
        <Text fz="sm">
          {mode === 'loaded'
            ? 'Removes the demo data and adds a fresh copy with dates counted from today. Anything changed while trying it out, in the demo shows or by the demo accounts, is lost.'
            : 'Adds the invented shows, companies and people again, with dates counted from today, so BluePrint can be tried out as every kind of account.'}
        </Text>
        <Group>
          <Button
            variant="default"
            leftSection={<IconRefresh size={16} />}
            loading={reset.pending}
            onClick={() =>
              modals.openConfirmModal({
                title: label,
                children: <Text fz="sm">This takes up to a minute. {mode === 'loaded' ? 'The demo shows start again from scratch.' : ''}</Text>,
                labels: { confirm: label, cancel: 'Cancel' },
                onConfirm: () => reset.run(),
              })
            }
          >
            {label}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

/** Removes every demo show, company, supplier and person. The super admin types a phrase to confirm. */
export function RemoveDemo() {
  const router = useRouter();
  const [typed, setTyped] = useState('');
  const remove = useAction(removeDemoDataAction, { onSuccess: () => router.refresh() });
  const ready = typed.trim().toLowerCase() === CONFIRMATION;
  return (
    <Paper withBorder p="md" style={{ borderColor: 'var(--mantine-color-red-4)' }}>
      <Stack gap="sm">
        <Title order={2} fz="md">
          Remove the demo data
        </Title>
        <Alert color="red" variant="light">
          Deletes everything listed above for good, and the demo accounts can no longer sign in. Your own shows, companies and people are not touched, and nor is anything a real show uses.
        </Alert>
        <TextInput
          label={`Type “${CONFIRMATION}” to confirm`}
          value={typed}
          onChange={(e) => setTyped(e.currentTarget.value)}
          error={remove.fieldErrors.confirmation}
          maw={420}
          autoComplete="off"
        />
        <Group>
          <Button
            color="red"
            leftSection={<IconTrash size={16} />}
            disabled={!ready}
            loading={remove.pending}
            onClick={() =>
              modals.openConfirmModal({
                title: 'Remove the demo data for good?',
                children: <Text fz="sm">This cannot be undone.</Text>,
                labels: { confirm: 'Remove the demo data', cancel: 'Cancel' },
                confirmProps: { color: 'red' },
                onConfirm: () => remove.run(typed),
              })
            }
          >
            Remove the demo data
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
