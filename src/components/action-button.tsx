'use client';

import { useState } from 'react';
import { Button, Group, Modal, Stack, Text, TextInput, type ButtonProps } from '@mantine/core';
import { useRouter } from 'next/navigation';
import { useAction } from '@/lib/use-action';
import type { ActionResult } from '@/lib/action-result';

type Props<A extends unknown[]> = ButtonProps & {
  action: (...args: A) => Promise<ActionResult<unknown> | void>;
  args: A;
  children: React.ReactNode;
  /** Ask before running. */
  confirm?: { title: string; body?: React.ReactNode; confirmLabel?: string; danger?: boolean; typeToConfirm?: string };
  /** Refresh the page data afterwards (on by default). */
  refresh?: boolean;
};

/** Runs a server action from a button, with an optional confirmation step. */
export function ActionButton<A extends unknown[]>({ action, args, children, confirm, refresh = true, ...buttonProps }: Props<A>) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const act = useAction(action, {
    onSuccess: () => {
      setOpen(false);
      setTyped('');
      if (refresh) router.refresh();
    },
  });
  const run = () => act.run(...args);
  return (
    <>
      <Button {...buttonProps} loading={act.pending} onClick={() => (confirm ? setOpen(true) : run())}>
        {children}
      </Button>
      {confirm ? (
        <Modal opened={open} onClose={() => setOpen(false)} title={confirm.title} centered>
          <Stack>
            {confirm.body ? typeof confirm.body === 'string' ? <Text fz="sm">{confirm.body}</Text> : confirm.body : null}
            {confirm.typeToConfirm ? (
              <TextInput
                label={`Type ${confirm.typeToConfirm} to confirm`}
                value={typed}
                onChange={(e) => setTyped(e.currentTarget.value)}
                autoComplete="off"
                data-autofocus
              />
            ) : null}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                color={confirm.danger ? 'red' : undefined}
                loading={act.pending}
                disabled={Boolean(confirm.typeToConfirm) && typed.trim() !== confirm.typeToConfirm}
                onClick={run}
              >
                {confirm.confirmLabel ?? 'Confirm'}
              </Button>
            </Group>
          </Stack>
        </Modal>
      ) : null}
    </>
  );
}
