import { desc } from 'drizzle-orm';
import { Paper, SimpleGrid, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, Title } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { TextLink } from '@/components/links';
import { StatCard } from '@/components/ui/stat-card';
import { StatusBadge } from '@/components/ui/status-badge';
import { requireSuperAdmin } from '@/server/auth/current';
import { platformCounts } from '@/server/services/users';
import { listShowsWithEditions } from '@/server/services/editions';
import { systemStatus } from '@/server/services/system';
import { getDb } from '@/server/db/client';
import { auditLog } from '@/server/db/schema';
import { dateShort, dateTime } from '@/lib/format';

export default async function AdminOverview() {
  const actor = await requireSuperAdmin();
  const counts = await platformCounts(actor);
  const shows = await listShowsWithEditions(actor);
  const status = await systemStatus(actor);
  const db = await getDb();
  const recent = await db.select().from(auditLog).orderBy(desc(auditLog.at)).limit(12);
  const editions = shows.flatMap((s) => s.editions.map((e) => ({ ...e, showName: s.name }))).filter((e) => e.status !== 'archived');
  const warnings = Object.entries(status.config).filter(([, v]) => /missing|Not set up|Not connected|Development key/.test(v));

  return (
    <Stack>
      <PageHeader title="Overview" description="Everything happening across BluePrint." />
      <SimpleGrid cols={{ base: 2, md: 4 }}>
        <StatCard label="Live editions" value={counts.liveEditions} />
        <StatCard label="Exhibiting companies" value={counts.companies} />
        <StatCard label="Active users" value={counts.users} />
        <StatCard label="Suppliers" value={counts.suppliers} />
      </SimpleGrid>

      {warnings.length ? (
        <Paper withBorder p="md" bg="var(--mantine-color-yellow-0)">
          <Text fw={600} mb={4}>
            Set-up still needed
          </Text>
          {warnings.map(([k, v]) => (
            <Text key={k} fz="sm">
              {k}: {v}
            </Text>
          ))}
          <TextLink href="/admin/system" fz="sm">
            Open system status
          </TextLink>
        </Paper>
      ) : null}

      <Paper withBorder p="md">
        <Title order={2} fz="lg" mb="sm">
          Editions
        </Title>
        <Table>
          <TableThead>
            <TableTr>
              <TableTh>Edition</TableTh>
              <TableTh>Opens</TableTh>
              <TableTh>Stands</TableTh>
              <TableTh>Status</TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {editions.map((e) => (
              <TableTr key={e.id}>
                <TableTd>
                  <TextLink href={`/admin/editions/${e.id}`}>
                    {e.name}
                  </TextLink>
                  <Text fz="xs" c="dimmed">
                    {e.showName}
                  </Text>
                </TableTd>
                <TableTd>{dateShort(e.openStartsAt)}</TableTd>
                <TableTd>{e.standCount}</TableTd>
                <TableTd>
                  <StatusBadge status={e.status} />
                </TableTd>
              </TableTr>
            ))}
            {editions.length === 0 ? (
              <TableTr>
                <TableTd colSpan={4}>
                  <Text c="dimmed" fz="sm">
                    No editions yet. <TextLink href="/admin/shows">Create a show</TextLink> to start.
                  </Text>
                </TableTd>
              </TableTr>
            ) : null}
          </TableTbody>
        </Table>
      </Paper>

      <Paper withBorder p="md">
        <Title order={2} fz="lg" mb="sm">
          Recent activity
        </Title>
        <Table>
          <TableTbody>
            {recent.map((r) => (
              <TableTr key={r.id}>
                <TableTd w={170}>
                  <Text fz="xs" c="dimmed">
                    {dateTime(r.at)}
                  </Text>
                </TableTd>
                <TableTd>
                  <Text fz="sm">{r.action}</Text>
                </TableTd>
                <TableTd>
                  <Text fz="sm" c="dimmed">
                    {r.actorEmail ?? 'BluePrint'}
                  </Text>
                </TableTd>
              </TableTr>
            ))}
          </TableTbody>
        </Table>
        <TextLink href="/admin/audit" fz="sm">
          Full audit log
        </TextLink>
      </Paper>
    </Stack>
  );
}
