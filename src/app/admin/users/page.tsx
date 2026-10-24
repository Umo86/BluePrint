import { Badge, Group, Paper, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageNav, SearchFilter } from '@/components/ui/list-controls';
import { TextLink } from '@/components/links';
import { requireSuperAdmin } from '@/server/auth/current';
import { listUsers, USER_FILTERS, type UserFilter } from '@/server/services/users';
import { dateTime } from '@/lib/format';
import { InviteSuperAdminButton } from './user-controls';

const FILTER_LABELS: Record<UserFilter, string> = {
  all: 'Everyone',
  super_admins: 'Super admins',
  staff: 'Show staff',
  exhibitors: 'Exhibitors',
  suppliers: 'Suppliers',
  contractors: 'Stand contractors',
  disabled: 'Disabled accounts',
};

export default async function UsersPage({ searchParams }: PageProps<'/admin/users'>) {
  const actor = await requireSuperAdmin();
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q.slice(0, 200) : '';
  const filter = (USER_FILTERS as readonly string[]).includes(String(sp.filter)) ? (sp.filter as UserFilter) : 'all';
  const page = Math.max(1, Number.parseInt(String(sp.page ?? '1'), 10) || 1);
  const result = await listUsers(actor, { q, filter, page });
  return (
    <Stack>
      <PageHeader
        title="Users"
        description="Everyone with a BluePrint account: super admins, show staff, exhibitors, suppliers and contractors. People are added by invitation from the area they belong to."
        actions={<InviteSuperAdminButton />}
      />
      <SearchFilter placeholder="Search by name or email" filterOptions={USER_FILTERS.map((f) => ({ value: f, label: FILTER_LABELS[f] }))} filterLabel="Show" />
      <Paper withBorder>
        <Table verticalSpacing="sm" highlightOnHover>
          <TableThead>
            <TableTr>
              <TableTh>Person</TableTh>
              <TableTh>Access</TableTh>
              <TableTh>Two-factor</TableTh>
              <TableTh>Last signed in</TableTh>
              <TableTh>Status</TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {result.rows.map((u) => (
              <TableTr key={u.id}>
                <TableTd>
                  <TextLink href={`/admin/users/${u.id}`} fw={600} fz="sm">
                    {u.name || u.email}
                  </TextLink>
                  <Text fz="xs" c="dimmed">
                    {u.email}
                  </Text>
                </TableTd>
                <TableTd>
                  <Group gap={4}>
                    {u.isSuperAdmin ? <Badge color="red" variant="light">Super admin</Badge> : null}
                    {u.staffCount ? <Badge variant="light">Staff · {u.staffCount}</Badge> : null}
                    {u.companyCount ? <Badge color="teal" variant="light">Exhibitor · {u.companyCount}</Badge> : null}
                    {u.supplierCount ? <Badge color="grape" variant="light">Supplier</Badge> : null}
                    {!u.isSuperAdmin && !u.staffCount && !u.companyCount && !u.supplierCount ? (
                      <Text fz="xs" c="dimmed">
                        No access yet
                      </Text>
                    ) : null}
                  </Group>
                </TableTd>
                <TableTd>{u.totpEnabledAt ? <Badge color="green" variant="dot">On</Badge> : <Text fz="xs" c="dimmed">Off</Text>}</TableTd>
                <TableTd>
                  <Text fz="sm">{u.lastLoginAt ? dateTime(u.lastLoginAt) : 'Never'}</Text>
                </TableTd>
                <TableTd>
                  <StatusBadge status={u.status} />
                </TableTd>
              </TableTr>
            ))}
          </TableTbody>
        </Table>
        {result.rows.length === 0 ? (
          <Text p="md" c="dimmed" fz="sm">
            Nobody matches.
          </Text>
        ) : null}
      </Paper>
      <PageNav total={result.total} page={result.page} pageSize={result.pageSize} />
    </Stack>
  );
}
