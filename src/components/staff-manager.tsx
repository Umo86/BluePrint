'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Checkbox,
  Group,
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
import { IconUserPlus } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import { PERMISSION_OPTIONS, ROLE_LABELS, ROLE_OPTIONS } from '@/lib/roles';
import { dateShort } from '@/lib/format';
import type { EditionPermission, EditionRole } from '@/server/db/schema';
import { inviteStaffAction, resendInvitationAction, revokeInvitationAction } from '@/app/admin/actions';
import { RightsMatrix } from './rights-matrix';

export type StaffRow = { userId: string; name: string; email: string; jobTitle?: string | null; role: EditionRole; permissions: string[] };
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
          onChange={(p) => {
            // Refunds are made from the orders pages: ticking refunds brings orders, and unticking orders takes refunds away.
            let next = p as EditionPermission[];
            if (next.includes('refunds') && !next.includes('manage_orders')) {
              next = value.permissions.includes('manage_orders') ? next.filter((x) => x !== 'refunds') : [...next, 'manage_orders'];
            }
            onChange({ ...value, permissions: next });
          }}
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

/** An edition's team with a tick box for each right, plus invitations. For show admins and super admins. */
export function StaffManager({
  editionId,
  staff,
  pending,
  currentUserId,
  viewerIsSuperAdmin = false,
}: {
  editionId: string;
  staff: StaffRow[];
  pending: PendingInvite[];
  currentUserId?: string;
  viewerIsSuperAdmin?: boolean;
}) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [access, setAccess] = useState<AccessValue>({ role: 'show_team', permissions: ['manage_exhibitors'] });

  const invite = useAction(inviteStaffAction, {
    onSuccess: () => {
      setInviteOpen(false);
      setEmail('');
      refresh();
    },
  });
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
          <RightsMatrix
            key={staff.map((x) => `${x.userId}:${x.role}:${x.permissions.join(',')}`).join('|')}
            editionId={editionId}
            mode="show"
            rows={staff.map((x) => ({ userId: x.userId, name: x.name, email: x.email, jobTitle: x.jobTitle ?? null, role: x.role, permissions: x.permissions }))}
            currentUserId={currentUserId}
            viewerIsSuperAdmin={viewerIsSuperAdmin}
          />
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

    </Stack>
  );
}
