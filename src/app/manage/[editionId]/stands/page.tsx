import { Badge, Paper, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { TextLink } from '@/components/links';
import { listStands } from '@/server/services/stands';
import { listExhibitorTypes, listHalls } from '@/server/services/show-setup';
import { plural, standSize } from '@/lib/format';
import { standFormValues } from '@/lib/stand-form';
import { loadEdition } from '../load';
import { AddStandButton, StandFiltersBar } from './stand-controls';
import { EditStandButton } from '../exhibitors/[companyId]/exhibitor-detail-controls';

function one(v: string | string[] | undefined) {
  return typeof v === 'string' ? v.slice(0, 200) : undefined;
}

export default async function StandsPage({ params, searchParams }: PageProps<'/manage/[editionId]/stands'>) {
  const { editionId } = await params;
  const { actor, edition, access } = await loadEdition(editionId);
  const sp = await searchParams;
  const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
  const status = one(sp.status) === 'cancelled' ? 'cancelled' : one(sp.status) === 'all' ? 'all' : 'active';
  const [rows, types, halls] = await Promise.all([
    listStands(actor, edition.id, { q: one(sp.q), typeId: uuid(one(sp.type)), hallId: uuid(one(sp.hall)), status }),
    listExhibitorTypes(actor, edition.id),
    listHalls(actor, edition.id),
  ]);
  const canManage = access.permissions.has('manage_exhibitors');
  const typeOptions = types.map((t) => ({ value: t.id, label: t.name }));
  const hallOptions = halls.map((h) => ({ value: h.id, label: h.name }));
  const totalSqm = rows.reduce((n, r) => n + (r.stand.sizeSqm ? Number(r.stand.sizeSqm) : 0), 0);
  return (
    <Stack>
      <PageHeader
        title="Stands"
        description={`${plural(rows.length, 'stand')} shown${totalSqm ? `, ${totalSqm.toLocaleString('en-GB')} sqm in total` : ''}. A stand’s type decides which tasks, pages and approvals its exhibitor gets.`}
        actions={canManage ? <AddStandButton editionId={edition.id} types={typeOptions} halls={hallOptions} /> : null}
      />
      <StandFiltersBar types={typeOptions} halls={hallOptions} />
      <Paper withBorder>
        <Table verticalSpacing="xs" highlightOnHover>
          <TableThead>
            <TableTr>
              <TableTh>Stand</TableTh>
              <TableTh>Type</TableTh>
              <TableTh>Hall</TableTh>
              <TableTh>Size</TableTh>
              <TableTh>Open sides</TableTh>
              <TableTh>Company</TableTh>
              <TableTh>Status</TableTh>
              {canManage ? <TableTh w={40} /> : null}
            </TableTr>
          </TableThead>
          <TableTbody>
            {rows.map(({ stand, type, hall, company }) => (
              <TableTr key={stand.id}>
                <TableTd fw={600}>{stand.number}</TableTd>
                <TableTd>
                  <Badge size="sm" variant="light" color={type.isSpaceOnly ? 'orange' : 'blue'}>
                    {type.name}
                  </Badge>
                </TableTd>
                <TableTd>{hall?.name ?? '—'}</TableTd>
                <TableTd>{standSize(stand) || '—'}</TableTd>
                <TableTd>{stand.openSides}</TableTd>
                <TableTd>
                  {company ? (
                    <TextLink href={`/manage/${edition.id}/exhibitors/${company.id}`} fz="sm">
                      {company.name}
                    </TextLink>
                  ) : (
                    <Text fz="sm" c="dimmed">
                      Not assigned
                    </Text>
                  )}
                </TableTd>
                <TableTd>
                  <StatusBadge status={stand.status} />
                </TableTd>
                {canManage ? (
                  <TableTd>
                    <EditStandButton
                      editionId={edition.id}
                      standId={stand.id}
                      initial={standFormValues(stand)}
                      types={typeOptions}
                      halls={hallOptions}
                      status={stand.status}
                    />
                  </TableTd>
                ) : null}
              </TableTr>
            ))}
          </TableTbody>
        </Table>
        {rows.length === 0 ? (
          <Text p="md" c="dimmed" fz="sm">
            No stands match.
          </Text>
        ) : null}
      </Paper>
    </Stack>
  );
}
