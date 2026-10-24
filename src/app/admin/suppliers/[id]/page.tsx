import { notFound } from 'next/navigation';
import { Badge, Group, List, ListItem, Paper, SimpleGrid, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, Title } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { ActionButton } from '@/components/action-button';
import { TextLink } from '@/components/links';
import { requireSuperAdmin } from '@/server/auth/current';
import { getSupplierDetail } from '@/server/services/suppliers';
import { getPlatformSettings } from '@/server/services/settings';
import { AppError } from '@/server/errors';
import { commissionLabel, dateShort } from '@/lib/format';
import { refreshSupplierStripeAction, removeSupplierUserAction, resendInvitationAction, revokeInvitationAction, setSupplierStatusAction } from '../../actions';
import { InviteSupplierUser, SupplierCommissionForm, SupplierDetailsForm } from '../supplier-controls';

export default async function SupplierPage({ params }: PageProps<'/admin/suppliers/[id]'>) {
  const { id } = await params;
  const actor = await requireSuperAdmin();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let detail: Awaited<ReturnType<typeof getSupplierDetail>>;
  try {
    detail = await getSupplierDetail(actor, id);
  } catch (err) {
    if (err instanceof AppError && (err.code === 'not_found' || err.code === 'forbidden')) notFound();
    throw err;
  }
  const settings = await getPlatformSettings();
  const { supplier, people, pendingInvites, categories } = detail;
  const disabled = supplier.status === 'disabled';
  return (
    <Stack>
      <PageHeader
        eyebrow="Supplier"
        title={supplier.name}
        description={supplier.email}
        actions={
          <Group gap="xs">
            <StatusBadge status={supplier.status} />
            <ActionButton
              action={setSupplierStatusAction}
              args={[supplier.id, disabled ? 'active' : 'disabled']}
              variant="default"
              confirm={
                disabled
                  ? undefined
                  : {
                      title: `Disable ${supplier.name}?`,
                      body: 'Their products are hidden from every shop and their people lose access to the supplier portal. Existing orders and payouts are kept.',
                      confirmLabel: 'Disable supplier',
                      danger: true,
                    }
              }
            >
              {disabled ? 'Enable' : 'Disable'}
            </ActionButton>
          </Group>
        }
      />
      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <Stack>
          <SupplierDetailsForm supplierId={supplier.id} initial={{ name: supplier.name, email: supplier.email, phone: supplier.phone ?? '', website: supplier.website ?? '' }} />
          <SupplierCommissionForm
            supplierId={supplier.id}
            type={supplier.commissionType}
            value={supplier.commissionValue}
            defaultLabel={commissionLabel(settings.defaultCommissionType, settings.defaultCommissionValue)}
            vatRegistered={supplier.vatRegistered}
          />
        </Stack>
        <Stack>
          <Paper withBorder p="md">
            <Title order={3} fz="md" mb="sm">
              Payouts (Stripe)
            </Title>
            <Table variant="vertical">
              <TableTbody>
                <TableTr>
                  <TableTh w={200}>Connected account</TableTh>
                  <TableTd>{supplier.stripeAccountId ? <Text ff="monospace" fz="sm">{supplier.stripeAccountId}</Text> : 'Not connected yet'}</TableTd>
                </TableTr>
                <TableTr>
                  <TableTh>Details submitted</TableTh>
                  <TableTd>{supplier.stripeDetailsSubmitted ? 'Yes' : 'No'}</TableTd>
                </TableTr>
                <TableTr>
                  <TableTh>Can take payments</TableTh>
                  <TableTd>{supplier.stripeChargesEnabled ? 'Yes' : 'No'}</TableTd>
                </TableTr>
                <TableTr>
                  <TableTh>Payouts enabled</TableTh>
                  <TableTd>{supplier.stripePayoutsEnabled ? <Badge color="green">Yes</Badge> : <Badge color="yellow">No</Badge>}</TableTd>
                </TableTr>
              </TableTbody>
            </Table>
            <Text fz="xs" c="dimmed" mt="xs">
              The supplier connects their own bank details with Stripe from the supplier portal. BluePrint never sees or stores bank details.
            </Text>
            {supplier.stripeAccountId ? (
              <ActionButton action={refreshSupplierStripeAction} args={[supplier.id]} variant="default" size="xs" mt="sm">
                Check status with Stripe
              </ActionButton>
            ) : null}
          </Paper>

          <Paper withBorder p="md">
            <Title order={3} fz="md" mb="sm">
              People ({people.length})
            </Title>
            <Stack gap="xs" mb="md">
              {people.map((p) => (
                <Group key={p.user.id} justify="space-between">
                  <div>
                    <TextLink href={`/admin/users/${p.user.id}`} fz="sm" fw={600}>
                      {p.user.name || p.user.email}
                    </TextLink>
                    <Text fz="xs" c="dimmed">
                      {p.user.email}
                    </Text>
                  </div>
                  <ActionButton
                    action={removeSupplierUserAction}
                    args={[supplier.id, p.user.id]}
                    size="compact-xs"
                    variant="subtle"
                    color="red"
                    confirm={{ title: `Remove ${p.user.name || p.user.email}?`, body: 'They lose access to this supplier’s orders and payouts.', confirmLabel: 'Remove', danger: true }}
                  >
                    Remove
                  </ActionButton>
                </Group>
              ))}
              {people.length === 0 ? (
                <Text fz="sm" c="dimmed">
                  Nobody yet.
                </Text>
              ) : null}
            </Stack>
            <InviteSupplierUser supplierId={supplier.id} />
            {pendingInvites.length ? (
              <Table mt="md">
                <TableThead>
                  <TableTr>
                    <TableTh>Invited</TableTh>
                    <TableTh>Expires</TableTh>
                    <TableTh />
                  </TableTr>
                </TableThead>
                <TableTbody>
                  {pendingInvites.map((inv) => (
                    <TableTr key={inv.id}>
                      <TableTd>{inv.email}</TableTd>
                      <TableTd>{dateShort(inv.expiresAt)}</TableTd>
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
            ) : null}
          </Paper>

          <Paper withBorder p="md">
            <Title order={3} fz="md" mb="sm">
              Service categories they fulfil
            </Title>
            {categories.length ? (
              <List size="sm">
                {categories.map((c) => (
                  <ListItem key={c.id}>
                    {c.editionName}: {c.name}
                  </ListItem>
                ))}
              </List>
            ) : (
              <Text fz="sm" c="dimmed">
                Not assigned to any category yet. Show admins assign suppliers in each show’s services set-up.
              </Text>
            )}
          </Paper>
        </Stack>
      </SimpleGrid>
    </Stack>
  );
}
