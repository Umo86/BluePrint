'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Group,
  Menu,
  Modal,
  Paper,
  Radio,
  Stack,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconDots, IconUserPlus } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import { PERMISSION_LABELS, PERMISSION_OPTIONS, ROLE_LABELS, ROLE_OPTIONS } from '@/lib/roles';
import { dateShort } from '@/lib/format';
import type { EditionPermission, EditionRole } from '@/server/db/schema';
import { inviteStaffAction, removeStaffAction, resendInvitationAction, revokeInvitationAction, updateStaffAction } from '@/app/admin/actions';

export type StaffRow = { userId: string; name: string; email: string; role: EditionRole; permissions: string[] };
export type PendingInvite = { id: string; email: string; role: string; expiresAt: string };

type AccessValue = { role: EditionRole; permissions: EditionPermission[] };

function AccessFields({ value, onChange }: { value: AccessValue; onChange: (v: AccessValue) => void }) {
  return (
    <Stack gap="sm">
      <Radio.Group label="Role" value={value.role} onChange={(r) => onChange({ ...value, role: r as EditionRole })}>
        <Stack gap={6} mt={6}>
          {ROLE_OPTIONS.map((r) => (
            <Radio key={r.value} value={r.value} label={r.label} description={r.description} />
          ))}
        </Stack>
      </Radio.Group>
      {value.role === 'show_team' ? (
        <Checkbox.Group
          label="What can they do?"
          description="Everyone on the team can see the dashboard."
          value={value.permissions}
          onChange={(p) => onChange({ ...value, permissions: p as EditionPermission[] })}
        >
          <Stack gap={6} mt={6}>
            {PERMISSION_OPTIONS.map((p) => (
              <Checkbox key={p.value} value={p.value} label={p.label} description={p.description} />
            ))}
          </Stack>
        </Checkbox.Group>
      ) : null}
    </Stack>
  );
}

function accessSummary(s: { role: string; permissions: string[] }) {
  if (s.role !== 'show_team') return ROLE_LABELS[s.role] ?? s.role;
  const list = s.permissions.filter((p) => p !== 'view').map((p) => PERMISSION_LABELS[p] ?? p);
  return list.length ? list.join(', ') : 'View only';
}

/** Lists an edition's team and lets a show admin or super admin invite, change and remove people. */
export function StaffManager({ editionId, staff, pending, currentUserId }: { editionId: string; staff: StaffRow[]; pending: PendingInvite[]; currentUserId?: string }) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [access, setAccess] = useState<AccessValue>({ role: 'show_team', permissions: ['manage_exhibitors'] });
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [editAccess, setEditAccess] = useState<AccessValue>({ role: 'show_team', permissions: [] });

  const invite = useAction(inviteStaffAction, {
    onSuccess: () => {
      setInviteOpen(false);
      setEmail('');
      refresh();
    },
  });
  const update = useAction(updateStaffAction, { onSuccess: () => { setEditing(null); refresh(); } });
  const remove = useAction(removeStaffAction, { onSuccess: refresh });
  const resend = useAction(resendInvitationAction, { onSuccess: refresh });
  const revoke = useAction(revokeInvitationAction, { onSuccess: refresh });

  return (
    <Stack>
      <Paper withBorder p="md">
        <Group justify="space-between" mb="sm">
          <Title order={3} fz="md">
            Team ({staff.length})
          </Title>
          <Button size="xs" leftSection={<IconUserPlus size={14} />} onClick={() => setInviteOpen(true)}>
            Invite someone
          </Button>
        </Group>
        {staff.length ? (
          <Table verticalSpacing="xs">
            <TableThead>
              <TableTr>
                <TableTh>Name</TableTh>
                <TableTh>Role</TableTh>
                <TableTh>Can do</TableTh>
                <TableTh w={40} />
              </TableTr>
            </TableThead>
            <TableTbody>
              {staff.map((s) => (
                <TableTr key={s.userId}>
                  <TableTd>
                    <Text fz="sm" fw={600}>
                      {s.name || s.email}
                    </Text>
                    <Text fz="xs" c="dimmed">
                      {s.email}
                    </Text>
                  </TableTd>
                  <TableTd>
                    <Badge variant="light" color={s.role === 'show_admin' ? 'blueprint' : s.role === 'hs_reviewer' ? 'orange' : 'gray'}>
                      {ROLE_LABELS[s.role]}
                    </Badge>
                  </TableTd>
                  <TableTd>
                    <Text fz="sm">{accessSummary(s)}</Text>
                  </TableTd>
                  <TableTd>
                    <Menu position="bottom-end">
                      <Menu.Target>
                        <ActionIcon variant="subtle" aria-label={`Change access for ${s.email}`}>
                          <IconDots size={16} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item
                          onClick={() => {
                            setEditing(s);
                            setEditAccess({ role: s.role, permissions: s.permissions.filter((p) => p !== 'view') as EditionPermission[] });
                          }}
                        >
                          Change access
                        </Menu.Item>
                        <Menu.Item
                          color="red"
                          disabled={s.userId === currentUserId}
                          onClick={() =>
                            modals.openConfirmModal({
                              title: `Remove ${s.name || s.email} from the team?`,
                              children: <Text fz="sm">They lose access to this edition straight away.</Text>,
                              labels: { confirm: 'Remove', cancel: 'Cancel' },
                              confirmProps: { color: 'red' },
                              onConfirm: () => remove.run(editionId, s.userId),
                            })
                          }
                        >
                          Remove from team
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </TableTd>
                </TableTr>
              ))}
            </TableTbody>
          </Table>
        ) : (
          <Text fz="sm" c="dimmed">
            Nobody on the team yet. Invite a show admin first.
          </Text>
        )}
      </Paper>

      {pending.length ? (
        <Paper withBorder p="md">
          <Title order={3} fz="md" mb="sm">
            Waiting to accept ({pending.length})
          </Title>
          <Table verticalSpacing="xs">
            <TableThead>
              <TableTr>
                <TableTh>Email</TableTh>
                <TableTh>Role</TableTh>
                <TableTh>Link expires</TableTh>
                <TableTh />
              </TableTr>
            </TableThead>
            <TableTbody>
              {pending.map((p) => (
                <TableTr key={p.id}>
                  <TableTd>{p.email}</TableTd>
                  <TableTd>{ROLE_LABELS[p.role] ?? p.role}</TableTd>
                  <TableTd>{dateShort(p.expiresAt)}</TableTd>
                  <TableTd>
                    <Group gap="xs" justify="flex-end">
                      <Button size="compact-xs" variant="light" loading={resend.pending} onClick={() => resend.run(p.id)}>
                        Send again
                      </Button>
                      <Button size="compact-xs" variant="subtle" color="red" loading={revoke.pending} onClick={() => revoke.run(p.id)}>
                        Cancel
                      </Button>
                    </Group>
                  </TableTd>
                </TableTr>
              ))}
            </TableTbody>
          </Table>
        </Paper>
      ) : null}

      <Modal opened={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite to the team" size="lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            invite.run(editionId, email, access.role, access.role === 'show_team' ? access.permissions : []);
          }}
        >
          <Stack>
            <TextInput label="Email address" type="email" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} error={invite.fieldErrors.email} data-autofocus />
            <AccessFields value={access} onChange={setAccess} />
            <Text fz="xs" c="dimmed">
              They get an email with a link. To accept, they confirm a code sent to the same address and set up two-factor sign-in.
            </Text>
            <Group justify="flex-end">
              <Button type="submit" loading={invite.pending}>
                Send invitation
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal opened={Boolean(editing)} onClose={() => setEditing(null)} title={`Access for ${editing?.name || editing?.email || ''}`} size="lg">
        <Stack>
          <AccessFields value={editAccess} onChange={setEditAccess} />
          <Group justify="flex-end">
            <Button
              loading={update.pending}
              onClick={() => editing && update.run(editionId, editing.userId, editAccess.role, editAccess.role === 'show_team' ? editAccess.permissions : [])}
            >
              Save access
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
