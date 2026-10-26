'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Center, Code, CopyButton, Image, List, Loader, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { useRouter } from 'next/navigation';
import { useAction } from '@/lib/use-action';
import { beginEnrollmentAction, confirmEnrollmentAction } from '../actions';

export function EnrollForm() {
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const begin = useAction(beginEnrollmentAction, { onSuccess: (d) => d && setSetup(d) });
  const confirm = useAction(confirmEnrollmentAction, { onSuccess: (d) => d && setRecovery(d.recoveryCodes) });

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void begin.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (recovery) {
    return (
      <Stack>
        <Alert color="green">Two-factor sign-in is on.</Alert>
        <Text fz="sm">
          Save these recovery codes somewhere safe, such as a password manager. Each one works once if you lose your phone. You will not see them again.
        </Text>
        <SimpleGrid cols={2} spacing="xs">
          {recovery.map((c) => (
            <Code key={c} fz="sm">
              {c}
            </Code>
          ))}
        </SimpleGrid>
        <CopyButton value={recovery.join('\n')}>
          {({ copied, copy }) => (
            <Button variant="light" onClick={copy}>
              {copied ? 'Copied' : 'Copy codes'}
            </Button>
          )}
        </CopyButton>
        <Button size="md" className="bp-notch" onClick={() => router.replace('/start')}>
          I have saved my codes
        </Button>
      </Stack>
    );
  }

  if (!setup) {
    return (
      <Center py="lg">
        {begin.error ? <Alert color="red">{begin.error}</Alert> : <Loader aria-label="Preparing" />}
      </Center>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        confirm.run(code);
      }}
    >
      <Stack>
        <List type="ordered" fz="sm" spacing={4}>
          <List.Item>Open an authenticator app such as Microsoft Authenticator or Google Authenticator.</List.Item>
          <List.Item>Scan this QR code, or type the key below.</List.Item>
          <List.Item>Enter the six-digit code the app shows.</List.Item>
        </List>
        <Center>
          <Image src={setup.qrDataUrl} alt="QR code for your authenticator app" w={200} h={200} />
        </Center>
        <Text fz="xs" c="dimmed" ta="center">
          Key: <Code>{setup.secret.match(/.{1,4}/g)?.join(' ')}</Code>
        </Text>
        <TextInput label="Six-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(e) => setCode(e.currentTarget.value)} />
        {confirm.error ? <Alert color="red">{confirm.error}</Alert> : null}
        <Button type="submit" size="md" className="bp-notch" loading={confirm.pending}>
          Turn on two-factor sign-in
        </Button>
      </Stack>
    </form>
  );
}
