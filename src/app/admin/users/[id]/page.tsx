import { notFound } from 'next/navigation';
import {
  Badge,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
  Title,
} from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { ActionButton } from '@/components/action-button';
import { DownloadButton, TextLink } from '@/components/links';
import { requireSuperAdmin } from '@/server/auth/current';
import { getUserDetail } from '@/server/services/users';
import { AppError } from '@/server/errors';
import { ROLE_LABELS, PERMISSION_LABELS } from '@/lib/roles';
import { dateShort, dateTime } from '@/lib/format';
import {
  anonymiseUserAction,
  removeMembershipAction,
  removeStaffAction,
  removeSupplierMembershipAction,
  resendInvitationAction,
  resetTwoFactorAction,
  revokeInvitationAction,
  revokeSessionsAction,
} from '../../actions';
import { AccessSwitches, UserProfileForm, ViewAsPicker } from '../user-controls';

const INVITE_KIND_LABELS: Record<string, string> = {
  super_admin: 'Super admin',
  edition_staff: 'Show team',
  exhibitor: 'Exhibitor',
  colleague: 'Colleague',
  contractor: 'Stand contractor',
  supplier: 'Supplier',
};

export default async function UserPage({ params }: PageProps<'/admin/users/[id]'>) {
  const { id } = await params;
  const actor = await requireSuperAdmin();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let detail: Awaited<ReturnType<typeof getUserDetail>>;
  try {
    detail = await getUserDetail(actor, id);
  } catch (err) {
    if (err instanceof AppError && err.code === 'not_found') notFound();
    throw err;
  }
  const { user } = detail;
  const isSelf = user.id === actor.realUserId;
  const anonymised = Boolean(user.anonymisedAt);
  const lockedUntil = user.lockedUntil && user.lockedUntil > new Date() ? user.lockedUntil : null;

  return (
    <Stack>
      <PageHeader
        eyebrow="User"
        title={user.name || user.email}
        description={user.email}
        actions={
          <Group gap="xs">
            {user.isSuperAdmin ? <Badge color="red">Super admin</Badge> : null}
            <StatusBadge status={user.status} />
          </Group>
        }
      />

      {anonymised ? (
        <Paper withBorder p="md">
          <Text>This person’s personal details were erased on {dateShort(user.anonymisedAt)}. Their business records remain, attached to an anonymous placeholder.</Text>
        </Paper>
      ) : (
        <>
          <SimpleGrid cols={{ base: 1, lg: 2 }}>
            <UserProfileForm user={{ id: user.id, name: user.name, email: user.email, phone: user.phone ?? '', jobTitle: user.jobTitle ?? '' }} />
            <Paper withBorder p="md">
              <Title order={3} fz="md" mb="sm">
                Access and security
              </Title>
              <Stack gap="md">
                <AccessSwitches userId={user.id} isSuperAdmin={user.isSuperAdmin} status={user.status} isSelf={isSelf} />
                <Table variant="vertical" withTableBorder={false}>
                  <TableTbody>
                    <TableTr>
                      <TableTh w={180}>Two-factor</TableTh>
                      <TableTd>{user.totpEnabledAt ? `On since ${dateShort(user.totpEnabledAt)}` : 'Not set up'}</TableTd>
                    </TableTr>
                    <TableTr>
                      <TableTh>Recovery codes left</TableTh>
                      <TableTd>{user.totpEnabledAt ? user.recoveryCodeHashes.length : '—'}</TableTd>
                    </TableTr>
                    <TableTr>
                      <TableTh>Password</TableTh>
                      <TableTd>{user.passwordHash ? 'Set' : 'Email codes only'}</TableTd>
                    </TableTr>
                    <TableTr>
                      <TableTh>Password lock</TableTh>
                      <TableTd>{lockedUntil ? `Locked until ${dateTime(lockedUntil)}` : 'Not locked'}</TableTd>
                    </TableTr>
                    <TableTr>
                      <TableTh>Signed-in devices</TableTh>
                      <TableTd>{detail.activeSessionCount}</TableTd>
                    </TableTr>
                    <TableTr>
                      <TableTh>Last signed in</TableTh>
                      <TableTd>{user.lastLoginAt ? dateTime(user.lastLoginAt) : 'Never'}</TableTd>
                    </TableTr>
                    <TableTr>
                      <TableTh>Account created</TableTh>
                      <TableTd>{dateShort(user.createdAt)}</TableTd>
                    </TableTr>
                  </TableTbody>
                </Table>
                <Group gap="xs">
                  <ActionButton
                    action={revokeSessionsAction}
                    args={[user.id]}
                    variant="default"
                    size="xs"
                    disabled={isSelf}
                    confirm={{ title: 'Sign out everywhere?', body: 'Every device they are signed in on is signed out straight away.', confirmLabel: 'Sign out everywhere' }}
                  >
                    Sign out everywhere
                  </ActionButton>
                  <ActionButton
                    action={resetTwoFactorAction}
                    args={[user.id]}
                    variant="default"
                    size="xs"
                    disabled={!user.totpEnabledAt || isSelf}
                    confirm={{
                      title: 'Reset two-factor?',
                      body: 'Use this when someone has lost their phone and recovery codes. Check who they are first, for example by phone. They set it up again at their next sign-in.',
                      confirmLabel: 'Reset two-factor',
                      danger: true,
                    }}
                  >
                    Reset two-factor
                  </ActionButton>
                </Group>
              </Stack>
            </Paper>
          </SimpleGrid>

          <Paper withBorder p="md">
            <Title order={3} fz="md" mb="sm">
              Where they have access
            </Title>
            <Stack gap="lg">
              <div>
                <Text fw={600} fz="sm" mb={4}>
                  Show teams
                </Text>
                {detail.staff.length ? (
                  <Table>
                    <TableThead>
                      <TableTr>
                        <TableTh>Edition</TableTh>
                        <TableTh>Role</TableTh>
                        <TableTh>Can do</TableTh>
                        <TableTh />
                      </TableTr>
                    </TableThead>
                    <TableTbody>
                      {detail.staff.map((s) => (
                        <TableTr key={s.edition.id}>
                          <TableTd>
                            <TextLink href={`/admin/editions/${s.edition.id}`}>{s.edition.name}</TextLink>
                          </TableTd>
                          <TableTd>{ROLE_LABELS[s.role]}</TableTd>
                          <TableTd>
                            <Text fz="sm">{s.role === 'show_team' ? s.permissions.map((p) => PERMISSION_LABELS[p] ?? p).join(', ') || 'View only' : '—'}</Text>
                          </TableTd>
                          <TableTd align="right">
                            <ActionButton
                              action={removeStaffAction}
                              args={[s.edition.id, user.id]}
                              size="compact-xs"
                              variant="subtle"
                              color="red"
                              confirm={{ title: `Remove from the ${s.edition.name} team?`, confirmLabel: 'Remove', danger: true }}
                            >
                              Remove
                            </ActionButton>
                          </TableTd>
                        </TableTr>
                      ))}
                    </TableTbody>
                  </Table>
                ) : (
                  <Text fz="sm" c="dimmed">
                    Not on any show team.
                  </Text>
                )}
              </div>

              <div>
                <Text fw={600} fz="sm" mb={4}>
                  Exhibiting companies
                </Text>
                {detail.memberships.length ? (
                  <Table>
                    <TableThead>
                      <TableTr>
                        <TableTh>Company</TableTh>
                        <TableTh>Role</TableTh>
                        <TableTh>Can pay</TableTh>
                        <TableTh />
                      </TableTr>
                    </TableThead>
                    <TableTbody>
                      {detail.memberships.map((m) => (
                        <TableTr key={m.company.id}>
                          <TableTd>
                            <TextLink href={`/admin/companies/${m.company.id}`}>{m.company.name}</TextLink>
                          </TableTd>
                          <TableTd>{m.role === 'main_contact' ? 'Main contact' : 'Colleague'}</TableTd>
                          <TableTd>{m.canPay ? 'Yes' : 'No'}</TableTd>
                          <TableTd align="right">
                            <ActionButton
                              action={removeMembershipAction}
                              args={[user.id, m.company.id]}
                              size="compact-xs"
                              variant="subtle"
                              color="red"
                              confirm={{ title: `Remove from ${m.company.name}?`, body: 'They lose access to the company’s stands and orders.', confirmLabel: 'Remove', danger: true }}
                            >
                              Remove
                            </ActionButton>
                          </TableTd>
                        </TableTr>
                      ))}
                    </TableTbody>
                  </Table>
                ) : (
                  <Text fz="sm" c="dimmed">
                    Not part of any exhibiting company.
                  </Text>
                )}
                {!isSelf ? (
                  <Stack mt="sm">
                    <ViewAsPicker
                      userId={user.id}
                      stands={[...new Map(detail.exhibitorStands.map((s) => [s.editionId, { editionId: s.editionId, label: `${s.editionName} · ${s.companyName} · stand ${s.standNumber}` }])).values()]}
                    />
                  </Stack>
                ) : null}
              </div>

              <div>
                <Text fw={600} fz="sm" mb={4}>
                  Suppliers
                </Text>
                {detail.suppliers.length ? (
                  <Stack gap={4}>
                    {detail.suppliers.map((s) => (
                      <Group key={s.id} justify="space-between">
                        <TextLink href={`/admin/suppliers/${s.id}`}>{s.name}</TextLink>
                        <ActionButton
                          action={removeSupplierMembershipAction}
                          args={[user.id, s.id]}
                          size="compact-xs"
                          variant="subtle"
                          color="red"
                          confirm={{ title: `Remove from ${s.name}?`, body: 'They lose access to the supplier portal, orders and payouts.', confirmLabel: 'Remove', danger: true }}
                        >
                          Remove
                        </ActionButton>
                      </Group>
                    ))}
                  </Stack>
                ) : (
                  <Text fz="sm" c="dimmed">
                    Not linked to a supplier.
                  </Text>
                )}
              </div>

              <div>
                <Text fw={600} fz="sm" mb={4}>
                  Stands they build (contractor)
                </Text>
                {detail.contractorStands.length ? (
                  <Stack gap={4}>
                    {detail.contractorStands.map((c) => (
                      // A div, not a paragraph: the status badge is a div, which a paragraph cannot hold.
                      <Text key={c.contractor.id} fz="sm" component="div">
                        {c.edition.name} · stand {c.stand.number} · <StatusBadge status={c.contractor.status} />
                      </Text>
                    ))}
                  </Stack>
                ) : (
                  <Text fz="sm" c="dimmed">
                    Not nominated as a contractor.
                  </Text>
                )}
              </div>
            </Stack>
          </Paper>

          {detail.pendingInvites.length ? (
            <Paper withBorder p="md">
              <Title order={3} fz="md" mb="sm">
                Invitations not yet accepted
              </Title>
              <Table>
                <TableThead>
                  <TableTr>
                    <TableTh>Type</TableTh>
                    <TableTh>Sent</TableTh>
                    <TableTh>Expires</TableTh>
                    <TableTh />
                  </TableTr>
                </TableThead>
                <TableTbody>
                  {detail.pendingInvites.map((inv) => (
                    <TableTr key={inv.id}>
                      <TableTd>{INVITE_KIND_LABELS[inv.kind] ?? inv.kind}</TableTd>
                      <TableTd>{dateShort(inv.lastSentAt ?? inv.createdAt)}</TableTd>
                      <TableTd>{inv.expiresAt < new Date() ? <Badge color="gray">Expired</Badge> : dateShort(inv.expiresAt)}</TableTd>
                      <TableTd>
                        <Group gap="xs" justify="flex-end">
                          <ActionButton action={resendInvitationAction} args={[inv.id]} size="compact-xs" variant="light">
                            Send again
                          </ActionButton>
                          <ActionButton action={revokeInvitationAction} args={[inv.id]} size="compact-xs" variant="subtle" color="red">
                            Cancel
                          </ActionButton>
                        </Group>
                      </TableTd>
                    </TableTr>
                  ))}
                </TableTbody>
              </Table>
            </Paper>
          ) : null}

          <Paper withBorder p="md">
            <Title order={3} fz="md" mb={4}>
              Privacy
            </Title>
            <Text fz="sm" c="dimmed" mb="sm">
              For subject access and erasure requests under UK GDPR.
            </Text>
            <Group gap="xs">
              <DownloadButton href={`/admin/gdpr/export/${user.id}`} variant="default" size="xs">
                Download their data (JSON)
              </DownloadButton>
              <ActionButton
                action={anonymiseUserAction}
                args={[user.id]}
                color="red"
                variant="light"
                size="xs"
                disabled={isSelf}
                refresh={false}
                confirm={{
                  title: 'Erase this person’s personal details?',
                  body: 'Their name, email, phone, sign-in details, assistant chats and access are removed for good. Orders, invoices and approvals stay (UK law requires them) but are attached to an anonymous placeholder. This cannot be undone.',
                  typeToConfirm: user.email,
                  confirmLabel: 'Erase for good',
                  danger: true,
                }}
              >
                Erase personal details
              </ActionButton>
            </Group>
          </Paper>
        </>
      )}
    </Stack>
  );
}
