import { desc } from 'drizzle-orm';
import { Group, Paper, SimpleGrid, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, Title } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { TextLink } from '@/components/links';
import { StatCard } from '@/components/ui/stat-card';
import { StatusBadge } from '@/components/ui/status-badge';
import { requireSuperAdmin } from '@/server/auth/current';
import { platformCounts } from '@/server/services/users';
import { editionsAtAGlance } from '@/server/services/overview';
import { systemStatus } from '@/server/services/system';
import { getDb } from '@/server/db/client';
import { auditLog } from '@/server/db/schema';
import { dateShort, dateTime, money } from '@/lib/format';
import { auditActionLabel } from '@/lib/audit-labels';
import { CONFIG_LABELS } from '@/lib/system-labels';

export default async function AdminOverview() {
  const actor = await requireSuperAdmin();
  const counts = await platformCounts(actor);
  const editions = await editionsAtAGlance(actor);
  const status = await systemStatus(actor);
  const db = await getDb();
  const recent = await db.select().from(auditLog).orderBy(desc(auditLog.at)).limit(12);
  const warnings = Object.entries(status.config).filter(([, v]) => /missing|Not set up|Not connected|Development key|Switched off/.test(v));

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
              {CONFIG_LABELS[k] ?? k}: {v}
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
              <TableTh ta="right">Stands</TableTh>
              <TableTh ta="right">Signed up</TableTh>
              <TableTh ta="right">Checklists</TableTh>
              <TableTh ta="right">Stands behind</TableTh>
              <TableTh ta="right">Shop sales</TableTh>
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
                <TableTd ta="right">{e.standCount}</TableTd>
                <TableTd ta="right">{e.signedUpPct === null ? '—' : `${e.signedUpPct}%`}</TableTd>
                <TableTd ta="right">{e.checklistPct === null ? '—' : `${e.checklistPct}%`}</TableTd>
                <TableTd ta="right">
                  <Text fz="sm" c={e.standsOverdue ? 'red' : undefined}>
                    {e.standsOverdue}
                  </Text>
                </TableTd>
                <TableTd ta="right">{money(e.salesPence)}</TableTd>
                <TableTd>
                  <Group gap={6} wrap="nowrap">
                    <StatusBadge status={e.status} />
                    <TextLink href={`/manage/${e.id}`} fz="xs">
                      Dashboard
                    </TextLink>
                  </Group>
                </TableTd>
              </TableTr>
            ))}
            {editions.length === 0 ? (
              <TableTr>
                <TableTd colSpan={8}>
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
                  <Text fz="sm">{auditActionLabel(r.action)}</Text>
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
