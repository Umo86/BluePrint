import { Badge, Group, Paper, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { TextLink } from '@/components/links';
import { requireSuperAdmin } from '@/server/auth/current';
import { listSuppliers } from '@/server/services/suppliers';
import { getPlatformSettings } from '@/server/services/settings';
import { commissionLabel } from '@/lib/format';
import { NewSupplierButton } from './supplier-controls';

export default async function SuppliersPage() {
  const actor = await requireSuperAdmin();
  const [rows, settings] = await Promise.all([listSuppliers(actor), getPlatformSettings()]);
  return (
    <Stack>
      <PageHeader
        title="Suppliers"
        description="Official contractors who sell services through BluePrint (furniture, electrics, AV, cleaning and so on). Each one is paid out through their own Stripe account, less your commission."
        actions={<NewSupplierButton />}
      />
      <Paper withBorder>
        <Table verticalSpacing="sm" highlightOnHover>
          <TableThead>
            <TableTr>
              <TableTh>Supplier</TableTh>
              <TableTh>People</TableTh>
              <TableTh>Categories</TableTh>
              <TableTh>Commission</TableTh>
              <TableTh>Payouts</TableTh>
              <TableTh>Status</TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {rows.map(({ supplier, userCount, categoryCount }) => (
              <TableTr key={supplier.id}>
                <TableTd>
                  <TextLink href={`/admin/suppliers/${supplier.id}`} fw={600} fz="sm">
                    {supplier.name}
                  </TextLink>
                  <Text fz="xs" c="dimmed">
                    {supplier.email}
                  </Text>
                </TableTd>
                <TableTd>{userCount}</TableTd>
                <TableTd>{categoryCount}</TableTd>
                <TableTd>
                  {supplier.commissionType ? (
                    commissionLabel(supplier.commissionType, supplier.commissionValue)
                  ) : (
                    <Text fz="sm" c="dimmed">
                      Default ({commissionLabel(settings.defaultCommissionType, settings.defaultCommissionValue)})
                    </Text>
                  )}
                </TableTd>
                <TableTd>
                  {supplier.stripePayoutsEnabled ? (
                    <Badge color="green" variant="light">
                      Ready
                    </Badge>
                  ) : supplier.stripeAccountId ? (
                    <Badge color="yellow" variant="light">
                      Set-up not finished
                    </Badge>
                  ) : (
                    <Badge color="gray" variant="light">
                      Not connected
                    </Badge>
                  )}
                </TableTd>
                <TableTd>
                  <StatusBadge status={supplier.status} />
                </TableTd>
              </TableTr>
            ))}
          </TableTbody>
        </Table>
        {rows.length === 0 ? (
          <Group p="md">
            <Text c="dimmed" fz="sm">
              No suppliers yet.
            </Text>
          </Group>
        ) : null}
      </Paper>
    </Stack>
  );
}
