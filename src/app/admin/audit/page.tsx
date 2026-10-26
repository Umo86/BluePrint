import { Code, Paper, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { PageNav } from '@/components/ui/list-controls';
import { DownloadButton, TextLink } from '@/components/links';
import { requireSuperAdmin } from '@/server/auth/current';
import { queryAuditLog, type AuditFilters } from '@/server/services/audit-log';
import { listShowsWithEditions } from '@/server/services/editions';
import { dateTime } from '@/lib/format';
import { auditActionLabel, auditDetailLines } from '@/lib/audit-labels';
import { AuditFilterForm } from './audit-filters';

function str(v: string | string[] | undefined, max = 200) {
  return typeof v === 'string' ? v.slice(0, max) : undefined;
}

export default async function AuditPage({ searchParams }: PageProps<'/admin/audit'>) {
  const actor = await requireSuperAdmin();
  const sp = await searchParams;
  const editionId = str(sp.edition);
  const filters: AuditFilters = {
    action: str(sp.action),
    actorEmail: str(sp.who),
    editionId: editionId && /^[0-9a-f-]{36}$/i.test(editionId) ? editionId : undefined,
    entityId: str(sp.entity),
    from: str(sp.from, 10),
    to: str(sp.to, 10),
    page: Math.max(1, Number.parseInt(String(sp.page ?? '1'), 10) || 1),
  };
  const [result, shows] = await Promise.all([queryAuditLog(actor, filters), listShowsWithEditions(actor)]);
  const editionNames = new Map(shows.flatMap((s) => s.editions.map((e) => [e.id, e.name] as const)));
  const exportQs = new URLSearchParams(
    Object.entries({ action: filters.action, who: filters.actorEmail, edition: filters.editionId, entity: filters.entityId, from: filters.from, to: filters.to }).filter(
      (e): e is [string, string] => Boolean(e[1]),
    ),
  ).toString();
  return (
    <Stack>
      <PageHeader
        title="Audit log"
        description="Every sign-in, change, approval, refund, email send and data download, with who did it and from where. Entries can’t be edited; personal details are only removed when someone’s data is erased."
        actions={
          <DownloadButton href={`/admin/audit/export${exportQs ? `?${exportQs}` : ''}`} variant="default">
            Download CSV
          </DownloadButton>
        }
      />
      <AuditFilterForm editions={[...editionNames.entries()].map(([value, label]) => ({ value, label }))} />
      <Paper withBorder>
        <Table verticalSpacing="xs" fz="sm">
          <TableThead>
            <TableTr>
              <TableTh w={150}>When</TableTh>
              <TableTh>Who</TableTh>
              <TableTh>What</TableTh>
              <TableTh>Edition</TableTh>
              <TableTh>Details</TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {result.rows.map((r) => (
              <TableTr key={r.id}>
                <TableTd style={{ whiteSpace: 'nowrap' }}>{dateTime(r.at)}</TableTd>
                <TableTd>
                  {r.actorUserId ? (
                    <TextLink href={`/admin/users/${r.actorUserId}`} fz="sm">
                      {r.actorEmail ?? 'Unknown'}
                    </TextLink>
                  ) : (
                    <Text fz="sm">{r.actorEmail ?? 'System'}</Text>
                  )}
                  {r.details?.viewingAs ? (
                    <Text fz="xs" c="orange">
                      while viewing as someone else
                    </Text>
                  ) : null}
                  {r.ip ? (
                    <Text fz="xs" c="dimmed">
                      {r.ip}
                    </Text>
                  ) : null}
                </TableTd>
                <TableTd>
                  <Text fz="sm">{auditActionLabel(r.action)}</Text>
                  <Code fz="xs">{r.action}</Code>
                  {r.entityType ? (
                    <Text fz="xs" c="dimmed">
                      {r.entityType}
                      {r.entityId ? ` ${r.entityId.slice(0, 8)}` : ''}
                    </Text>
                  ) : null}
                </TableTd>
                <TableTd>{r.editionId ? editionNames.get(r.editionId) ?? '—' : '—'}</TableTd>
                <TableTd>
                  {r.details && Object.keys(r.details).length ? (
                    // Scrollable, so it can take keyboard focus and be scrolled without a mouse.
                    <Text component="div" fz="xs" mah={90} style={{ overflow: 'auto', maxWidth: 380, overflowWrap: 'anywhere' }} tabIndex={0} aria-label="Details">
                      {auditDetailLines(r.details).map((line) => (
                        <div key={line}>{line}</div>
                      ))}
                    </Text>
                  ) : null}
                </TableTd>
              </TableTr>
            ))}
          </TableTbody>
        </Table>
        {result.rows.length === 0 ? (
          <Text p="md" c="dimmed" fz="sm">
            No entries match.
          </Text>
        ) : null}
      </Paper>
      <PageNav total={result.total} page={result.page} pageSize={result.pageSize} />
    </Stack>
  );
}
