'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, Badge, Button, Group, Paper, PasswordInput, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useAction } from '@/lib/use-action';
import { removePasswordAction, revokeSessionAction, setPasswordAction, signOutOtherDevicesAction, updateProfileAction } from './actions';

type Props = {
  profile: { name: string; email: string; phone: string; jobTitle: string };
  hasPassword: boolean;
  twoFactorEnabled: boolean;
  /** False while two-factor sign-in is switched off for everyone (then the section is hidden). */
  twoFactorAvailable: boolean;
  isStaff: boolean;
  recoveryCodesLeft: number;
  currentSessionId: string;
  sessions: { id: string; createdAt: string; lastSeenAt: string; userAgent: string; ip: string }[];
};

function describeAgent(ua: string) {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /iPhone|iPad/.test(ua) ? 'iPhone or iPad' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : '';
  return [browser, os].filter(Boolean).join(' on ');
}

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export function AccountForms(props: Props) {
  const [profile, setProfile] = useState(props.profile);
  const [password, setPassword] = useState('');
  const saveProfile = useAction(updateProfileAction);
  const savePassword = useAction(setPasswordAction, { onSuccess: () => setPassword('') });
  const dropPassword = useAction(removePasswordAction);
  const signOutOthers = useAction(signOutOtherDevicesAction);
  const revoke = useAction(revokeSessionAction);

  return (
    <Stack gap="lg">
      <Paper withBorder p="lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveProfile.run({ name: profile.name, phone: profile.phone, jobTitle: profile.jobTitle });
          }}
        >
          <Stack>
            <Title order={2} fz="lg">
              Your details
            </Title>
            <TextInput label="Email" value={profile.email} disabled description="To change your email, ask the show team." />
            <TextInput label="Name" required value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.currentTarget.value })} error={saveProfile.fieldErrors.name} />
            <Group grow>
              <TextInput label="Phone" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.currentTarget.value })} />
              <TextInput label="Job title" value={profile.jobTitle} onChange={(e) => setProfile({ ...profile, jobTitle: e.currentTarget.value })} />
            </Group>
            <Group>
              <Button type="submit" loading={saveProfile.pending}>
                Save details
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>

      <Paper withBorder p="lg">
        <Stack>
          <Title order={2} fz="lg">
            Password
          </Title>
          <Text fz="sm" c="dimmed">
            {props.hasPassword
              ? 'You can sign in with your password or with an emailed code.'
              : 'You sign in with emailed codes. Add a password if you prefer.'}
          </Text>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              savePassword.run(password);
            }}
          >
            <Stack>
              <PasswordInput
                label={props.hasPassword ? 'New password' : 'Password'}
                description="At least 12 characters. A short sentence works well."
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                error={savePassword.fieldErrors.password}
              />
              <Group>
                <Button type="submit" loading={savePassword.pending} disabled={password.length === 0}>
                  {props.hasPassword ? 'Change password' : 'Add password'}
                </Button>
                {props.hasPassword ? (
                  <Button variant="subtle" color="red" onClick={() => dropPassword.run()} loading={dropPassword.pending}>
                    Remove password
                  </Button>
                ) : null}
              </Group>
            </Stack>
          </form>
        </Stack>
      </Paper>

      {props.twoFactorAvailable ? (
        <Paper withBorder p="lg">
          <Stack>
            <Group justify="space-between">
              <Title order={2} fz="lg">
                Two-factor sign-in
              </Title>
              {props.twoFactorEnabled ? <Badge color="green">On</Badge> : <Badge color="gray">Off</Badge>}
            </Group>
            {props.twoFactorEnabled ? (
              <Text fz="sm">
                Your authenticator app is set up. You have {props.recoveryCodesLeft} recovery code{props.recoveryCodesLeft === 1 ? '' : 's'} left.
              </Text>
            ) : props.isStaff ? (
              <Alert color="orange">Staff accounts must use two-factor sign-in.</Alert>
            ) : (
              <Text fz="sm">Add a second step at sign-in using an authenticator app.</Text>
            )}
            {!props.twoFactorEnabled ? (
              <Group>
                <Button component={Link} href="/two-factor-setup" variant="light">
                  Set up two-factor sign-in
                </Button>
              </Group>
            ) : null}
          </Stack>
        </Paper>
      ) : null}

      <Paper withBorder p="lg">
        <Stack>
          <Group justify="space-between">
            <Title order={2} fz="lg">
              Where you are signed in
            </Title>
            <Button size="xs" variant="light" color="red" onClick={() => signOutOthers.run()} loading={signOutOthers.pending}>
              Sign out other devices
            </Button>
          </Group>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Device</Table.Th>
                <Table.Th>Last active</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {props.sessions.map((s) => (
                <Table.Tr key={s.id}>
                  <Table.Td>
                    <Text fz="sm">{describeAgent(s.userAgent)}</Text>
                    <Text fz="xs" c="dimmed">
                      Signed in {when(s.createdAt)}
                      {s.ip ? ` · ${s.ip}` : ''}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text fz="sm">{when(s.lastSeenAt)}</Text>
                  </Table.Td>
                  <Table.Td ta="right">
                    {s.id === props.currentSessionId ? (
                      <Badge variant="light">This device</Badge>
                    ) : (
                      <Button size="xs" variant="subtle" color="red" onClick={() => revoke.run(s.id)}>
                        Sign out
                      </Button>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Stack>
      </Paper>
    </Stack>
  );
}
