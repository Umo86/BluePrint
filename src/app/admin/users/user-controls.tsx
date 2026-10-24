'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Group, Modal, Paper, Select, Stack, Switch, Text, TextInput, Title } from '@mantine/core';
import { IconShieldPlus } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import { startViewAsAction } from '@/app/view-as-actions';
import { inviteSuperAdminAction, setSuperAdminAction, setUserStatusAction, updateUserAction } from '../actions';

export function InviteSuperAdminButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const invite = useAction(inviteSuperAdminAction, {
    onSuccess: () => {
      setOpen(false);
      setEmail('');
      router.refresh();
    },
  });
  return (
    <>
      <Button leftSection={<IconShieldPlus size={16} />} onClick={() => setOpen(true)}>
        Invite a super admin
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title="Invite a super admin">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            invite.run(email);
          }}
        >
          <Stack>
            <Alert color="red" variant="light">
              Super admins control every show, user, payment setting and record in BluePrint. Only invite people who need it.
            </Alert>
            <TextInput label="Email address" type="email" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} error={invite.fieldErrors.email} data-autofocus />
            <Text fz="xs" c="dimmed">
              To accept, they confirm a code sent to this address and must set up two-factor sign-in.
            </Text>
            <Group justify="flex-end">
              <Button type="submit" loading={invite.pending}>
                Send invitation
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
}

export function UserProfileForm({ user }: { user: { id: string; name: string; email: string; phone: string; jobTitle: string } }) {
  const router = useRouter();
  const [f, setF] = useState(user);
  const save = useAction(updateUserAction, { onSuccess: () => router.refresh() });
  return (
    <Paper withBorder p="md">
      <Title order={3} fz="md" mb="sm">
        Profile
      </Title>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.run(user.id, { name: f.name, email: f.email, phone: f.phone, jobTitle: f.jobTitle });
        }}
      >
        <Stack gap="sm">
          <Group grow>
            <TextInput label="Name" required value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} error={save.fieldErrors.name} />
            <TextInput
              label="Email"
              required
              value={f.email}
              onChange={(e) => setF({ ...f, email: e.currentTarget.value })}
              error={save.fieldErrors.email}
              description="Changing it signs them out everywhere."
            />
          </Group>
          <Group grow>
            <TextInput label="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.currentTarget.value })} />
            <TextInput label="Job title" value={f.jobTitle} onChange={(e) => setF({ ...f, jobTitle: e.currentTarget.value })} />
          </Group>
          <Group>
            <Button type="submit" loading={save.pending}>
              Save profile
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  );
}

export function AccessSwitches({ userId, isSuperAdmin, status, isSelf }: { userId: string; isSuperAdmin: boolean; status: string; isSelf: boolean }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<null | 'grant' | 'revoke' | 'disable'>(null);
  // Local copies so the switches flip as soon as the change is saved, without waiting for the page to refresh.
  const [admin, setAdmin] = useState(isSuperAdmin);
  const [enabled, setEnabled] = useState(status !== 'disabled');
  const superAdmin = useAction(setSuperAdminAction);
  const setStatus = useAction(setUserStatusAction);

  const changeAdmin = async (value: boolean) => {
    const res = await superAdmin.run(userId, value);
    if (res.ok) {
      setAdmin(value);
      setConfirm(null);
      router.refresh();
    }
  };
  const changeEnabled = async (value: boolean) => {
    const res = await setStatus.run(userId, value ? 'active' : 'disabled');
    if (res.ok) {
      setEnabled(value);
      setConfirm(null);
      router.refresh();
    }
  };

  return (
    <Stack gap="sm">
      <Switch
        label="Super admin"
        description="Full control of BluePrint. Takes effect at their next sign-in, with two-factor."
        checked={admin}
        disabled={isSelf || superAdmin.pending}
        onChange={(e) => setConfirm(e.currentTarget.checked ? 'grant' : 'revoke')}
      />
      <Switch
        label="Account enabled"
        description="Disabling signs them out everywhere and blocks sign-in. Their records stay."
        checked={enabled}
        disabled={isSelf || setStatus.pending}
        color="green"
        onChange={(e) => (e.currentTarget.checked ? changeEnabled(true) : setConfirm('disable'))}
      />
      <Modal opened={confirm !== null} onClose={() => setConfirm(null)} title="Please confirm" centered>
        <Stack>
          <Text fz="sm">
            {confirm === 'grant'
              ? 'Give this person full control of BluePrint, including every show, payment setting and personal record?'
              : confirm === 'revoke'
                ? 'Remove their super admin rights? They will be signed out.'
                : 'Disable this account? They will be signed out everywhere and cannot sign in until you enable it again.'}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              color={confirm === 'grant' ? undefined : 'red'}
              loading={superAdmin.pending || setStatus.pending}
              onClick={() => {
                if (confirm === 'grant') changeAdmin(true);
                else if (confirm === 'revoke') changeAdmin(false);
                else changeEnabled(false);
              }}
            >
              Confirm
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

export function ViewAsPicker({ userId, stands }: { userId: string; stands: { editionId: string; label: string }[] }) {
  const [editionId, setEditionId] = useState<string | null>(stands[0]?.editionId ?? null);
  const start = useAction(startViewAsAction);
  if (!stands.length) return null;
  return (
    <Group align="flex-end" gap="xs">
      <Select
        label="See the exhibitor portal as this person"
        description="Read-only. Nothing can be changed while viewing, and it is recorded in the audit log."
        data={stands.map((s) => ({ value: s.editionId, label: s.label }))}
        value={editionId}
        onChange={setEditionId}
        allowDeselect={false}
        w={360}
      />
      <Button variant="light" loading={start.pending} disabled={!editionId} onClick={() => editionId && start.run(userId, editionId)}>
        View as
      </Button>
    </Group>
  );
}
