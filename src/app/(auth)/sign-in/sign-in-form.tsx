'use client';

import { useState } from 'react';
import { Alert, Anchor, Button, Code, Group, PasswordInput, PinInput, Stack, Text, TextInput } from '@mantine/core';
import { useAction } from '@/lib/use-action';
import { passwordSignInAction, requestCodeAction, verifyCodeAction } from '../actions';

type TestLogin = { role: string; email: string; password: string; note?: string | null };

/**
 * Test logins, one per kind of account, shown under the form while the site is being tried out
 * (TEST_LOGINS). Each one signs straight in as that account.
 */
function TestLogins({ logins, onUse, busy }: { logins: TestLogin[]; onUse: (l: TestLogin) => void; busy: string | null }) {
  return (
    <Alert color="blueprint" title="Test logins" role="note" styles={{ root: { border: '1px dashed var(--mantine-color-blueprint-6)' } }}>
      <Stack gap={0}>
        <Text fz="xs" c="dimmed" mb={6}>
          For testing only. Each account sees BluePrint as that kind of user, with demo data.
        </Text>
        {logins.map((l) => (
          <Group key={l.email} justify="space-between" wrap="nowrap" gap="sm" py={8} style={{ borderTop: '1px solid var(--mantine-color-blueprint-2)' }}>
            <div style={{ minWidth: 0 }}>
              <Text fz="sm" fw={600}>
                {l.role}
              </Text>
              {l.note ? (
                <Text fz="xs" c="dimmed">
                  {l.note}
                </Text>
              ) : null}
              <Text fz="xs" truncate>
                {l.email}
              </Text>
              <Text fz="xs">
                Password: <Code fz="xs">{l.password}</Code>
              </Text>
            </div>
            <Button size="xs" variant="default" onClick={() => onUse(l)} loading={busy === l.email} disabled={Boolean(busy) && busy !== l.email} aria-label={`Sign in as ${l.role}`} style={{ flexShrink: 0 }}>
              Sign in
            </Button>
          </Group>
        ))}
      </Stack>
    </Alert>
  );
}

/**
 * One screen: email and password. People without a password can have a code emailed instead, when
 * email sending is set up (`codes`).
 */
export function SignInForm({ next, signedOut, testLogins = [], codes = false }: { next: string; signedOut?: boolean; testLogins?: TestLogin[]; codes?: boolean }) {
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<'password' | 'email' | 'code'>('password');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  // Which test login is signing in, so its button can show progress.
  const [testing, setTesting] = useState<string | null>(null);

  const request = useAction(requestCodeAction, { onSuccess: () => setStep('code') });
  // These show their errors in the form, so no pop-up as well.
  const verify = useAction(verifyCodeAction, { notifyErrors: false });
  const withPassword = useAction(passwordSignInAction, { notifyErrors: false });

  if (step === 'code') {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          verify.run(email, code, next);
        }}
      >
        <Stack>
          <Text fz="sm">
            If <strong>{email}</strong> has a BluePrint account, a code is on its way. It expires in 10 minutes.
          </Text>
          <div>
            <Text component="label" htmlFor="code" fz="sm" fw={600} mb={6} display="block">
              Six-digit code
            </Text>
            <PinInput id="code" length={6} type="number" oneTimeCode value={code} onChange={setCode} aria-label="Six-digit code" autoFocus />
          </div>
          {verify.error ? <Alert color="red">{verify.error}</Alert> : null}
          <Button type="submit" size="md" className="bp-notch" loading={verify.pending} disabled={code.length !== 6}>
            Sign in
          </Button>
          <Anchor component="button" type="button" fz="sm" onClick={() => request.run(email)}>
            Send a new code
          </Anchor>
          <Anchor component="button" type="button" fz="sm" c="dimmed" onClick={() => setStep('email')}>
            Use a different email
          </Anchor>
        </Stack>
      </form>
    );
  }

  if (step === 'email') {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          request.run(email);
        }}
      >
        <Stack>
          <TextInput
            label="Work email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            error={request.fieldErrors.email}
          />
          <Button type="submit" size="md" className="bp-notch" loading={request.pending}>
            Email me a code
          </Button>
          <Anchor component="button" type="button" fz="sm" onClick={() => setStep('password')}>
            Sign in with a password instead
          </Anchor>
        </Stack>
      </form>
    );
  }

  return (
    <Stack gap="xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          withPassword.run(email, password, next);
        }}
      >
        <Stack>
          {signedOut ? <Alert color="green">You have signed out.</Alert> : null}
          <TextInput label="Email" type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
          <PasswordInput label="Password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
          {withPassword.error ? <Alert color="red">{withPassword.error}</Alert> : null}
          <Button type="submit" size="md" className="bp-notch" loading={withPassword.pending}>
            Sign in
          </Button>
          {codes ? (
            <Anchor component="button" type="button" fz="sm" onClick={() => setStep('email')}>
              No password? Email me a sign-in code
            </Anchor>
          ) : null}
        </Stack>
      </form>
      {testLogins.length ? (
        <TestLogins
          logins={testLogins}
          busy={withPassword.pending ? testing : null}
          onUse={(l) => {
            setEmail(l.email);
            setPassword(l.password);
            setTesting(l.email);
            void withPassword.run(l.email, l.password, next);
          }}
        />
      ) : null}
    </Stack>
  );
}
