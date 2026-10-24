import { notFound } from 'next/navigation';
import { Group, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { PageHeader } from '@/components/ui/page-header';
import { DownloadButton, TextLink } from '@/components/links';
import { availableReports } from '@/server/reports';
import { loadEdition } from '../load';

const GROUPS = ['Exhibitors', 'Shop', 'Space-only'] as const;

export default async function Reports({ params }: PageProps<'/manage/[editionId]/reports'>) {
  const { editionId } = await params;
  const { actor, edition, access } = await loadEdition(editionId);
  const reports = await availableReports(actor, edition.id);
  if (!reports.length) notFound();
  const base = `/manage/${edition.id}`;
  const p = access.permissions;
  const views = [
    { label: 'Exhibitors, with checklist progress and filters', href: `${base}/exhibitors`, show: p.has('view') },
    { label: 'Task completion and answers, task by task', href: `${base}/tasks`, show: p.has('view') },
    { label: 'Services by stand (the delivery list)', href: `${base}/orders/services`, show: p.has('manage_orders') || p.has('view_reports') },
    { label: 'Commission and payouts', href: `${base}/orders/commission`, show: p.has('manage_orders') || p.has('view_reports') },
    { label: 'Space-only approvals', href: `${base}/space-only`, show: p.has('review_space_only') || p.has('manage_exhibitors') },
  ].filter((v) => v.show);
  return (
    <Stack>
      <PageHeader
        title="Reports"
        description="Download up-to-date Excel files for this show. Each download is recorded. The files contain personal information about exhibitors, so keep them within Media10 and delete them when you no longer need them."
      />
      {GROUPS.map((g) => {
        const inGroup = reports.filter((r) => r.group === g);
        if (!inGroup.length) return null;
        return (
          <div key={g}>
            <Title order={2} fz="md" mb="xs">
              {g}
            </Title>
            <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }}>
              {inGroup.map((r) => (
                <Paper key={r.key} withBorder p="md">
                  <Stack gap="xs" h="100%" justify="space-between">
                    <div>
                      <Text fw={600}>{r.title}</Text>
                      <Text fz="sm" c="dimmed">
                        {r.description}
                      </Text>
                    </div>
                    <Group>
                      <DownloadButton href={`${base}/reports/${r.key}`} variant="light" size="xs" leftSection={<IconDownload size={14} />} aria-label={`Download ${r.title} (Excel)`}>
                        Download (Excel)
                      </DownloadButton>
                    </Group>
                  </Stack>
                </Paper>
              ))}
            </SimpleGrid>
          </div>
        );
      })}
      {views.length ? (
        <Paper withBorder p="md">
          <Title order={2} fz="md" mb="xs">
            On screen
          </Title>
          <Stack gap={4}>
            {views.map((v) => (
              <TextLink key={v.href} href={v.href} fz="sm">
                {v.label}
              </TextLink>
            ))}
          </Stack>
        </Paper>
      ) : null}
    </Stack>
  );
}
