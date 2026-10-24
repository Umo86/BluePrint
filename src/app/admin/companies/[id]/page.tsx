import { notFound } from 'next/navigation';
import { Badge, Group, Paper, SimpleGrid, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, Title } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { ActionButton } from '@/components/action-button';
import { TextLink } from '@/components/links';
import { requireSuperAdmin } from '@/server/auth/current';
import { getCompanyDetail } from '@/server/services/companies';
import { AppError } from '@/server/errors';
import { dateShort } from '@/lib/format';
import { archiveCompanyAction } from '../../actions';
import { CompanyDetailsForm, InvoiceSwitch, MemberMenu } from '../company-controls';

export default async function CompanyPage({ params }: PageProps<'/admin/companies/[id]'>) {
  const { id } = await params;
  const actor = await requireSuperAdmin();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let detail: Awaited<ReturnType<typeof getCompanyDetail>>;
  try {
    detail = await getCompanyDetail(actor, id);
  } catch (err) {
    if (err instanceof AppError && err.code === 'not_found') notFound();
    throw err;
  }
  const { company, members, stands } = detail;
  const archived = Boolean(company.archivedAt);
  return (
    <Stack>
      <PageHeader
        eyebrow="Company"
        title={company.name}
        description={company.website ?? undefined}
        actions={
          <Group gap="xs">
            {archived ? <Badge color="dark">Archived</Badge> : null}
            <ActionButton
              action={archiveCompanyAction}
              args={[company.id, !archived]}
              variant="default"
              confirm={
                archived
                  ? undefined
                  : { title: `Archive ${company.name}?`, body: 'It disappears from lists and searches. Stands, orders and records are kept, and you can restore it at any time.', confirmLabel: 'Archive' }
              }
            >
              {archived ? 'Restore' : 'Archive'}
            </ActionButton>
          </Group>
        }
      />
      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <CompanyDetailsForm
          companyId={company.id}
          initial={{
            name: company.name,
            website: company.website ?? '',
            email: company.email ?? '',
            phone: company.phone ?? '',
            description: company.description ?? '',
            addressLine1: company.addressLine1 ?? '',
            addressLine2: company.addressLine2 ?? '',
            city: company.city ?? '',
            postcode: company.postcode ?? '',
            country: company.country ?? '',
            vatNumber: company.vatNumber ?? '',
            aspExhibitorId: company.aspExhibitorId ?? '',
          }}
        />
        <Stack>
          <Paper withBorder p="md">
            <Title order={3} fz="md" mb="sm">
              Payment
            </Title>
            <InvoiceSwitch companyId={company.id} allowed={company.invoiceAllowed} />
          </Paper>
          <Paper withBorder p="md">
            <Title order={3} fz="md" mb="sm">
              People ({members.length})
            </Title>
            {members.length ? (
              <Table>
                <TableThead>
                  <TableTr>
                    <TableTh>Name</TableTh>
                    <TableTh>Role</TableTh>
                    <TableTh>Can pay</TableTh>
                    <TableTh w={40} />
                  </TableTr>
                </TableThead>
                <TableTbody>
                  {members.map((m) => (
                    <TableTr key={m.user.id}>
                      <TableTd>
                        <TextLink href={`/admin/users/${m.user.id}`} fz="sm" fw={600}>
                          {m.user.name || m.user.email}
                        </TextLink>
                        <Text fz="xs" c="dimmed">
                          {m.user.email}
                        </Text>
                      </TableTd>
                      <TableTd>{m.role === 'main_contact' ? <Badge variant="light">Main contact</Badge> : 'Colleague'}</TableTd>
                      <TableTd>{m.canPay ? 'Yes' : 'No'}</TableTd>
                      <TableTd>
                        <MemberMenu companyId={company.id} member={{ userId: m.user.id, name: m.user.name || m.user.email, role: m.role, canPay: m.canPay }} />
                      </TableTd>
                    </TableTr>
                  ))}
                </TableTbody>
              </Table>
            ) : (
              <Text fz="sm" c="dimmed">
                Nobody yet. People join when the show team invites them to a stand.
              </Text>
            )}
          </Paper>
          <Paper withBorder p="md">
            <Title order={3} fz="md" mb="sm">
              Stands
            </Title>
            {stands.length ? (
              <Table>
                <TableThead>
                  <TableTr>
                    <TableTh>Edition</TableTh>
                    <TableTh>Stand</TableTh>
                    <TableTh>Type</TableTh>
                    <TableTh>Status</TableTh>
                  </TableTr>
                </TableThead>
                <TableTbody>
                  {stands.map((s) => (
                    <TableTr key={s.stand.id}>
                      <TableTd>
                        <TextLink href={`/admin/editions/${s.edition.id}`} fz="sm">
                          {s.edition.name}
                        </TextLink>
                        <Text fz="xs" c="dimmed">
                          Opens {dateShort(s.edition.openStartsAt)}
                        </Text>
                      </TableTd>
                      <TableTd>{s.stand.number}</TableTd>
                      <TableTd>{s.type.name}</TableTd>
                      <TableTd>
                        <StatusBadge status={s.stand.status} />
                      </TableTd>
                    </TableTr>
                  ))}
                </TableTbody>
              </Table>
            ) : (
              <Text fz="sm" c="dimmed">
                No stands yet. Stands are added from each show’s dashboard.
              </Text>
            )}
          </Paper>
        </Stack>
      </SimpleGrid>
    </Stack>
  );
}
