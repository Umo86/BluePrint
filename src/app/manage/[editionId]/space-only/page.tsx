import { Badge, Group, Paper, SimpleGrid, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { DownloadButton, TextLink } from '@/components/links';
import { IconDownload } from '@tabler/icons-react';
import { spaceOnlyQueue } from '@/server/services/space-only';
import { PACK_STATUS_LABELS } from '@/lib/space-only';
import { dateShort, standSize } from '@/lib/format';
import { loadEdition } from '../load';
import { QueueFilter } from './queue-filter';

export default async function SpaceOnlyQueuePage({ params, searchParams }: PageProps<'/manage/[editionId]/space-only'>) {
  const { editionId } = await params;
  const { actor, edition } = await loadEdition(editionId, 'space_only');
  const sp = await searchParams;
  const view = typeof sp.view === 'string' && ['review', 'chase', 'all'].includes(sp.view) ? sp.view : 'review';
  const q = await spaceOnlyQueue(actor, edition.id);
  const rows =
    view === 'review'
      ? q.items.filter((i) => i.status === 'submitted' || i.status === 'under_review').sort((a, b) => (a.pack?.submittedAt?.getTime() ?? 0) - (b.pack?.submittedAt?.getTime() ?? 0))
      : view === 'chase'
        ? q.items.filter((i) => i.issues.length && !['approved', 'approved_with_conditions'].includes(i.status))
        : q.items;
  return (
    <Stack>
      <PageHeader
        title="Space-only approvals"
        description={`Every space-only stand needs its design and safety documents approved before build-up${q.daysToBuild !== null ? ` (${q.daysToBuild > 0 ? `${q.daysToBuild} days away` : 'started'})` : ''}.`}
        actions={
          <DownloadButton href={`/manage/${edition.id}/reports/space_only`} variant="default" leftSection={<IconDownload size={16} />}>
            Download (Excel)
          </DownloadButton>
        }
      />
      <SimpleGrid cols={{ base: 2, md: 4 }}>
        <StatCard label="Space-only stands" value={q.counts.total} />
        <StatCard label="To review" value={q.counts.toReview} color={q.counts.toReview ? 'blue' : undefined} />
        <StatCard label="Approved" value={q.counts.approved} />
        <StatCard label="To chase" value={q.counts.chase} color={q.counts.chase ? 'orange' : undefined} hint="No contractor, pack not sent or changes outstanding" />
      </SimpleGrid>
      <QueueFilter counts={{ review: q.counts.toReview, chase: q.counts.chase, all: q.counts.total }} />
      <Paper withBorder>
        <Table verticalSpacing="sm" highlightOnHover>
          <TableThead>
            <TableTr>
              <TableTh>Stand</TableTh>
              <TableTh>Exhibitor</TableTh>
              <TableTh>Contractor</TableTh>
              <TableTh>Status</TableTh>
              <TableTh>{view === 'chase' ? 'What is missing' : 'Sent'}</TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {rows.map((r) => {
              const s = PACK_STATUS_LABELS[r.status];
              return (
                <TableTr key={r.stand.id}>
                  <TableTd>
                    <TextLink href={`/manage/${edition.id}/space-only/${r.stand.id}`} fw={600}>
                      {r.stand.number}
                    </TextLink>
                    {r.hall ? (
                      <Text fz="xs" c="dimmed">
                        Hall {r.hall.name}
                        {standSize(r.stand) ? ` · ${standSize(r.stand)}` : ''}
                      </Text>
                    ) : null}
                  </TableTd>
                  <TableTd>{r.company?.name ?? '—'}</TableTd>
                  <TableTd>
                    {r.contractor ? (
                      <>
                        <Text fz="sm">{r.contractor.contractorCompanyName}</Text>
                        <Text fz="xs" c="dimmed">
                          {r.contractor.contactEmail}
                        </Text>
                      </>
                    ) : (
                      <Text fz="sm" c="dimmed">
                        Not nominated
                      </Text>
                    )}
                  </TableTd>
                  <TableTd>
                    <Group gap={4}>
                      <Badge variant="light" color={s.color}>
                        {s.label}
                      </Badge>
                      {r.pack?.isComplex ? (
                        <Badge variant="outline" color="orange" size="sm">
                          Complex
                        </Badge>
                      ) : null}
                    </Group>
                  </TableTd>
                  <TableTd>
                    {view === 'chase' ? (
                      <Text fz="sm">{r.issues.join(', ')}</Text>
                    ) : (
                      <Text fz="sm">{r.pack?.submittedAt ? `${dateShort(r.pack.submittedAt)} · v${r.pack.currentVersion}` : '—'}</Text>
                    )}
                  </TableTd>
                </TableTr>
              );
            })}
          </TableTbody>
        </Table>
        {!rows.length ? (
          <Text p="md" c="dimmed" fz="sm">
            {view === 'review' ? 'Nothing waiting for review.' : view === 'chase' ? 'Nobody to chase.' : 'No space-only stands yet.'}
          </Text>
        ) : null}
      </Paper>
    </Stack>
  );
}
