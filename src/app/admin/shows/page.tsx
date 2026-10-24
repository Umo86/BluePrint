import { Badge, Group, Paper, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, Title } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { TextLink } from '@/components/links';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { requireSuperAdmin } from '@/server/auth/current';
import { listShowsWithEditions } from '@/server/services/editions';
import { dateShort } from '@/lib/format';
import { NewShowButton, NewEditionButton, ShowMenu } from './show-controls';

export default async function ShowsPage() {
  const actor = await requireSuperAdmin();
  const shows = await listShowsWithEditions(actor);
  return (
    <Stack>
      <PageHeader
        title="Shows and editions"
        description="A show (such as UK Construction Week) has an edition for each year and venue. Clone last year's edition to start the next one."
        actions={<NewShowButton />}
      />
      {shows.length === 0 ? <EmptyState title="No shows yet" description="Create your first show, then add an edition." /> : null}
      {shows.map((show) => (
        <Paper key={show.id} withBorder p="md" opacity={show.archivedAt ? 0.6 : 1}>
          <Group justify="space-between" mb="sm" wrap="nowrap">
            <div>
              <Group gap="xs">
                <Title order={2} fz="lg">
                  {show.name}
                </Title>
                {show.archivedAt ? <Badge color="dark">Archived</Badge> : null}
              </Group>
              {show.description ? (
                <Text fz="sm" c="dimmed">
                  {show.description}
                </Text>
              ) : null}
            </div>
            <Group gap="xs">
              <NewEditionButton showId={show.id} showName={show.name} />
              <ShowMenu show={{ id: show.id, name: show.name, description: show.description ?? '', archived: Boolean(show.archivedAt), editionCount: show.editions.length }} />
            </Group>
          </Group>
          {show.editions.length ? (
            <Table>
              <TableThead>
                <TableTr>
                  <TableTh>Edition</TableTh>
                  <TableTh>Venue</TableTh>
                  <TableTh>Build-up</TableTh>
                  <TableTh>Open</TableTh>
                  <TableTh>Stands</TableTh>
                  <TableTh>Status</TableTh>
                </TableTr>
              </TableThead>
              <TableTbody>
                {show.editions.map((e) => (
                  <TableTr key={e.id}>
                    <TableTd>
                      <TextLink href={`/admin/editions/${e.id}`} fw={600}>
                        {e.name}
                      </TextLink>
                    </TableTd>
                    <TableTd>{[e.venue, e.city].filter(Boolean).join(', ') || '—'}</TableTd>
                    <TableTd>{dateShort(e.buildUpStartsAt)}</TableTd>
                    <TableTd>{dateShort(e.openStartsAt)}</TableTd>
                    <TableTd>{e.standCount}</TableTd>
                    <TableTd>
                      <StatusBadge status={e.status} />
                    </TableTd>
                  </TableTr>
                ))}
              </TableTbody>
            </Table>
          ) : (
            <Text fz="sm" c="dimmed">
              No editions yet.
            </Text>
          )}
        </Paper>
      ))}
    </Stack>
  );
}
