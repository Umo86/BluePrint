'use client';

import { useState } from 'react';
import { Alert, Button, Stack, Text, TextInput } from '@mantine/core';
import { useAction } from '@/lib/use-action';
import { acceptInviteAction, sendInviteCodeAction } from '../../actions';

const intro: Record<string, string> = {
  exhibitor: 'You will see your stand’s checklist, the exhibitor manual and the service shop.',
  colleague: 'You will see your stand’s checklist, the exhibitor manual and the service shop.',
  contractor: 'You will upload the space-only stand pack for the stand you are building, and see its review status.',
  supplier: 'You will manage your catalogue, see orders for your services and connect Stripe to get paid.',
  edition_staff: 'You will help run the show in BluePrint. Staff accounts use two-factor sign-in.',
  super_admin: 'You will have full control of BluePrint. Super admin accounts use two-factor sign-in.',
};

export function AcceptInviteForm({ token, needsEmailCode, existingName, kind }: { token: string; needsEmailCode: boolean; existingName: string; kind: string }) {
  const [name, setName] = useState(existingName);
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const sendCode = useAction(sendInviteCodeAction, { onSuccess: () => setCodeSent(true) });
  const accept = useAction(acceptInviteAction);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        accept.run(token, name, needsEmailCode ? code : null);
      }}
    >
      <Stack>
        <Text fz="sm">{intro[kind] ?? ''}</Text>
        <TextInput label="Your name" autoComplete="name" required value={name} onChange={(e) => setName(e.currentTarget.value)} error={accept.fieldErrors.name} maxLength={120} />
        {needsEmailCode ? (
          <>
            <Text fz="sm" c="dimmed">
              To protect staff and supplier accounts, confirm your email with a code.
            </Text>
            {codeSent ? (
              <TextInput
                label="Code from the email"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.currentTarget.value)}
                error={accept.fieldErrors.code}
              />
            ) : null}
            <Button variant={codeSent ? 'subtle' : 'light'} onClick={() => sendCode.run(token)} loading={sendCode.pending}>
              {codeSent ? 'Send another code' : 'Email me a code'}
            </Button>
          </>
        ) : null}
        {accept.error ? <Alert color="red">{accept.error}</Alert> : null}
        <Button type="submit" loading={accept.pending} disabled={needsEmailCode && !codeSent}>
          Accept and continue
        </Button>
      </Stack>
    </form>
  );
}
