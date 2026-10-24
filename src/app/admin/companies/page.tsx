import { Badge, Paper, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { PageNav, SearchFilter } from '@/components/ui/list-controls';
import { TextLink } from '@/components/links';
import { requireSuperAdmin } from '@/server/auth/current';
import { listCompanies } from '@/server/services/companies';
import { NewCompanyButton } from './company-controls';

export default async function CompaniesPage({ searchParams }: PageProps<'/admin/companies'>) {
  const actor = await requireSuperAdmin();
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q.slice(0, 200) : '';
  const includeArchived = sp.filter === 'all';
  const page = Math.max(1, Number.parseInt(String(sp.page ?? '1'), 10) || 1);
  const result = await listCompanies(actor, { q, page, includeArchived });
  return (
    <Stack>
      <PageHeader
        title="Companies"
        description="Exhibiting companies across every show. A company keeps one record from year to year; its stands belong to each edition."
        actions={<NewCompanyButton />}
      />
      <SearchFilter
        placeholder="Search companies"
        filterOptions={[
          { value: 'current', label: 'Current companies' },
          { value: 'all', label: 'Include archived' },
        ]}
        filterLabel="Show"
      />
      <Paper withBorder>
        <Table verticalSpacing="sm" highlightOnHover>
          <TableThead>
            <TableTr>
              <TableTh>Company</TableTh>
              <TableTh>People</TableTh>
              <TableTh>Stands</TableTh>
              <TableTh>Pay by invoice</TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {result.rows.map(({ company, memberCount, standCount }) => (
              <TableTr key={company.id}>
                <TableTd>
                  <TextLink href={`/admin/companies/${company.id}`} fw={600} fz="sm">
                    {company.name}
                  </TextLink>
                  {company.archivedAt ? (
                    <Badge ml="xs" color="dark" size="xs">
                      Archived
                    </Badge>
                  ) : null}
                  {company.website ? (
                    <Text fz="xs" c="dimmed">
                      {company.website.replace(/^https?:\/\//, '')}
                    </Text>
                  ) : null}
                </TableTd>
                <TableTd>{memberCount}</TableTd>
                <TableTd>{standCount}</TableTd>
                <TableTd>{company.invoiceAllowed ? <Badge variant="light">Allowed</Badge> : <Text fz="xs" c="dimmed">Card only</Text>}</TableTd>
              </TableTr>
            ))}
          </TableTbody>
        </Table>
        {result.rows.length === 0 ? (
          <Text p="md" c="dimmed" fz="sm">
            No companies found.
          </Text>
        ) : null}
      </Paper>
      <PageNav total={result.total} page={result.page} pageSize={result.pageSize} />
    </Stack>
  );
}
