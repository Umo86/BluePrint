import { Badge, Group, Paper, SimpleGrid, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, Title } from '@mantine/core';
import { ActionButton } from '@/components/action-button';
import { companyForPortal } from '@/server/services/portal';
import { dateShort } from '@/lib/format';
import { resendInvitationAction, revokeInvitationAction } from '@/app/admin/actions';
import { loadPortal } from '../load';
import { InviteColleague, MyCompanyForm, PersonActions } from './company-controls';

export default async function CompanyPage({ params }: PageProps<'/portal/[slug]/company'>) {
  const { slug } = await params;
  const ctx = await loadPortal(slug);
  const d = await companyForPortal(ctx.actor, ctx.stand.id);
  const c = d.company;
  const canManage = d.isMainContact && ctx.editable;
  return (
    <Stack>
      <div>
        <Title order={1} fz={30}>
          Your company and team
        </Title>
        <Text c="dimmed">
          {d.isMainContact ? 'As the main contact you can update your company details and invite colleagues.' : 'Your main contact can update these details and invite colleagues.'}
        </Text>
      </div>
      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <MyCompanyForm
          slug={ctx.edition.slug}
          companyId={c.id}
          readOnly={!canManage}
          initial={{
            name: c.name,
            website: c.website ?? '',
            email: c.email ?? '',
            phone: c.phone ?? '',
            description: c.description ?? '',
            addressLine1: c.addressLine1 ?? '',
            addressLine2: c.addressLine2 ?? '',
            city: c.city ?? '',
            postcode: c.postcode ?? '',
            country: c.country ?? '',
            vatNumber: c.vatNumber ?? '',
            aspExhibitorId: c.aspExhibitorId ?? '',
          }}
        />
        <Stack>
          <Paper withBorder p="md">
            <Title order={2} fz="md" mb="sm">
              People ({d.people.length})
            </Title>
            <Table>
              <TableThead>
                <TableTr>
                  <TableTh>Name</TableTh>
                  <TableTh>Role</TableTh>
                  <TableTh>Last signed in</TableTh>
                  {canManage ? <TableTh w={40} /> : null}
                </TableTr>
              </TableThead>
              <TableTbody>
                {d.people.map((p) => (
                  <TableTr key={p.id}>
                    <TableTd>
                      <Text fz="sm" fw={600}>
                        {p.name || p.email}
                        {p.id === ctx.actor.userId ? ' (you)' : ''}
                      </Text>
                      <Text fz="xs" c="dimmed">
                        {p.email}
                      </Text>
                    </TableTd>
                    <TableTd>
                      {p.role === 'main_contact' ? <Badge variant="light">Main contact</Badge> : <Text fz="sm">Colleague</Text>}
                      {p.role !== 'main_contact' && !p.canPay ? (
                        <Text fz="xs" c="dimmed">
                          Cannot pay
                        </Text>
                      ) : null}
                    </TableTd>
                    <TableTd>{p.lastLoginAt ? dateShort(p.lastLoginAt) : 'Not yet'}</TableTd>
                    {canManage ? (
                      <TableTd>{p.id !== ctx.actor.userId ? <PersonActions companyId={c.id} person={{ userId: p.id, name: p.name || p.email, role: p.role, canPay: p.canPay }} /> : null}</TableTd>
                    ) : null}
                  </TableTr>
                ))}
              </TableTbody>
            </Table>
            {canManage ? <InviteColleague slug={ctx.edition.slug} standId={ctx.stand.id} /> : null}
          </Paper>
          {canManage && d.pending.length ? (
            <Paper withBorder p="md">
              <Title order={2} fz="md" mb="sm">
                Invited, not joined yet
              </Title>
              <Stack gap="xs">
                {d.pending.map((inv) => (
                  <Group key={inv.id} justify="space-between">
                    <Text fz="sm">
                      {inv.email}{' '}
                      <Text span fz="xs" c="dimmed">
                        sent {dateShort(inv.lastSentAt ?? inv.createdAt)}
                      </Text>
                    </Text>
                    <Group gap="xs">
                      <ActionButton action={resendInvitationAction} args={[inv.id]} size="compact-xs" variant="light">
                        Send again
                      </ActionButton>
                      <ActionButton action={revokeInvitationAction} args={[inv.id]} size="compact-xs" variant="subtle" color="red">
                        Cancel
                      </ActionButton>
                    </Group>
                  </Group>
                ))}
              </Stack>
            </Paper>
          ) : null}
        </Stack>
      </SimpleGrid>
    </Stack>
  );
}
