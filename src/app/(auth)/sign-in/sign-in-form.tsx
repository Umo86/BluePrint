'use client';

import { useState } from 'react';
import { Alert, Anchor, Button, Code, PasswordInput, PinInput, Stack, Text, TextInput } from '@mantine/core';
import { useAction } from '@/lib/use-action';
import { passwordSignInAction, requestCodeAction, verifyCodeAction } from '../actions';

type TestLogin = { email: string; password: string } | null;

/** The test login box, shown only while TEST_LOGIN_EMAIL and TEST_LOGIN_PASSWORD are set. */
function TestLoginBox({ login, onUse }: { login: NonNullable<TestLogin>; onUse: () => void }) {
  return (
    <Alert color="blueprint" title="Test login" role="note" styles={{ root: { border: '1px dashed var(--mantine-color-blueprint-6)' } }}>
      <Stack gap={6}>
        <Text fz="sm">
          Email: <Code>{login.email}</Code>
          <br />
          Password: <Code>{login.password}</Code>
        </Text>
        <Text fz="xs" c="dimmed">
          For testing only. The first sign-in links an authenticator app to this account.
        </Text>
        <Button size="xs" variant="default" onClick={onUse} style={{ alignSelf: 'flex-start' }}>
          Use the test login
        </Button>
      </Stack>
    </Alert>
  );
}

export function SignInForm({ next, signedOut, testLogin = null }: { next: string; signedOut?: boolean; testLogin?: TestLogin }) {
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<'email' | 'code' | 'password'>('email');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');

  const request = useAction(requestCodeAction, { onSuccess: () => setStep('code') });
  const verify = useAction(verifyCodeAction);
  const withPassword = useAction(passwordSignInAction);

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

  if (step === 'password') {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          withPassword.run(email, password, next);
        }}
      >
        <Stack>
          <TextInput label="Email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
          <PasswordInput label="Password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
          {withPassword.error ? <Alert color="red">{withPassword.error}</Alert> : null}
          <Button type="submit" size="md" className="bp-notch" loading={withPassword.pending}>
            Sign in
          </Button>
          <Anchor component="button" type="button" fz="sm" onClick={() => setStep('email')}>
            Email me a code instead
          </Anchor>
        </Stack>
      </form>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        request.run(email);
      }}
    >
      <Stack>
        {signedOut ? <Alert color="green">You have signed out.</Alert> : null}
        {testLogin ? (
          <TestLoginBox
            login={testLogin}
            onUse={() => {
              setEmail(testLogin.email);
              setPassword(testLogin.password);
              setStep('password');
            }}
          />
        ) : null}
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
          Sign in with a password
        </Anchor>
      </Stack>
    </form>
  );
}
