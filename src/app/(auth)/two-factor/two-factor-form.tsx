'use client';

import { useState } from 'react';
import { Alert, Anchor, Button, Stack, Text, TextInput } from '@mantine/core';
import { useAction } from '@/lib/use-action';
import { signOutAction, twoFactorAction } from '../actions';

export function TwoFactorForm({ next }: { next: string }) {
  const [code, setCode] = useState('');
  const check = useAction(twoFactorAction);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        check.run(code, next);
      }}
    >
      <Stack>
        <TextInput
          label="Code from your authenticator app"
          description="Lost your phone? Enter one of your recovery codes instead."
          autoComplete="one-time-code"
          inputMode="text"
          required
          autoFocus
          value={code}
          onChange={(e) => setCode(e.currentTarget.value)}
          maxLength={20}
        />
        {check.error ? <Alert color="red">{check.error}</Alert> : null}
        <Button type="submit" loading={check.pending}>
          Continue
        </Button>
        <Text fz="xs" c="dimmed">
          Still stuck? A super admin can reset your two-factor sign-in.
        </Text>
        <Anchor component="button" type="button" fz="sm" onClick={() => signOutAction()}>
          Sign out
        </Anchor>
      </Stack>
    </form>
  );
}
