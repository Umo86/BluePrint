import { Badge, Group, Paper, SimpleGrid, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, Title } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { StatusBadge } from '@/components/ui/status-badge';
import { ActionButton } from '@/components/action-button';
import { requireSuperAdmin } from '@/server/auth/current';
import { systemStatus } from '@/server/services/system';
import { dateTime } from '@/lib/format';
import { removeSuppressionAction, retryEmailsAction } from '../actions';

const CONFIG_LABELS: Record<string, string> = {
  database: 'Database',
  email: 'Email sending',
  emailWebhooks: 'Email delivery events',
  storage: 'File storage',
  payments: 'Payments',
  paymentWebhooks: 'Payment events',
  assistant: 'Assistant',
  cron: 'Scheduled jobs',
  encryptionKey: 'Encryption key',
};

const WARN = /missing|Not set up|Not connected|Development key|Local/;

export default async function SystemPage() {
  const actor = await requireSuperAdmin();
  const s = await systemStatus(actor);
  const by = s.emailByStatus;
  return (
    <Stack>
      <PageHeader title="System" description="Connections, email delivery and scheduled jobs. Use this to check BluePrint is healthy." />
      <Paper withBorder p="md">
        <Title order={2} fz="md" mb="sm">
          Connections
        </Title>
        <Table variant="vertical">
          <TableTbody>
            {Object.entries(s.config).map(([k, v]) => (
              <TableTr key={k}>
                <TableTh w={240}>{CONFIG_LABELS[k] ?? k}</TableTh>
                <TableTd>
                  <Group gap="xs">
                    <Badge color={WARN.test(v) ? 'yellow' : 'green'} variant="dot">
                      {v}
                    </Badge>
                  </Group>
                </TableTd>
              </TableTr>
            ))}
          </TableTbody>
        </Table>
        <Text fz="xs" c="dimmed" mt="xs">
          Keys and secrets are set as environment variables on the hosting platform and are never shown here.
        </Text>
      </Paper>

      <Title order={2} fz="md">
        Email in the last 7 days
      </Title>
      <SimpleGrid cols={{ base: 2, md: 5 }}>
        <StatCard label="Sent" value={(by.sent ?? 0) + (by.delivered ?? 0) + (by.opened ?? 0) + (by.clicked ?? 0)} />
        <StatCard label="Waiting" value={by.queued ?? 0} />
        <StatCard label="Failed" value={by.failed ?? 0} color={by.failed ? 'red' : undefined} />
        <StatCard label="Bounced" value={by.bounced ?? 0} color={by.bounced ? 'orange' : undefined} />
        <StatCard label="Not sent (blocked)" value={by.suppressed ?? 0} hint="Unsubscribed or bounced before" />
      </SimpleGrid>

      <Paper withBorder p="md">
        <Group justify="space-between" mb="sm">
          <Title order={2} fz="md">
            Failed emails ({s.failed.length})
          </Title>
          <ActionButton action={retryEmailsAction} args={[]} size="xs" variant="light" disabled={!s.failed.length}>
            Try sending again
          </ActionButton>
        </Group>
        {s.failed.length ? (
          <Table fz="sm">
            <TableThead>
              <TableTr>
                <TableTh>When</TableTh>
                <TableTh>To</TableTh>
                <TableTh>Subject</TableTh>
                <TableTh>Attempts</TableTh>
                <TableTh>Error</TableTh>
              </TableTr>
            </TableThead>
            <TableTbody>
              {s.failed.map((e) => (
                <TableTr key={e.id}>
                  <TableTd>{dateTime(e.createdAt)}</TableTd>
                  <TableTd>{e.toEmail}</TableTd>
                  <TableTd>{e.subject}</TableTd>
                  <TableTd>{e.attempts}</TableTd>
                  <TableTd>
                    <Text fz="xs" c="red" lineClamp={2}>
                      {e.error ?? ''}
                    </Text>
                  </TableTd>
                </TableTr>
              ))}
            </TableTbody>
          </Table>
        ) : (
          <Text fz="sm" c="dimmed">
            No failed emails.
          </Text>
        )}
      </Paper>

      <Paper withBorder p="md">
        <Title order={2} fz="md" mb={4}>
          Blocked addresses ({s.suppressions.length})
        </Title>
        <Text fz="sm" c="dimmed" mb="sm">
          BluePrint stops emailing an address after a hard bounce or a spam complaint, to protect the sending domain’s reputation. Only unblock an address once you know it works.
        </Text>
        {s.suppressions.length ? (
          <Table fz="sm">
            <TableThead>
              <TableTr>
                <TableTh>Address</TableTh>
                <TableTh>Reason</TableTh>
                <TableTh>Since</TableTh>
                <TableTh />
              </TableTr>
            </TableThead>
            <TableTbody>
              {s.suppressions.map((x) => (
                <TableTr key={x.email}>
                  <TableTd>{x.email}</TableTd>
                  <TableTd>{x.reason}</TableTd>
                  <TableTd>{dateTime(x.createdAt)}</TableTd>
                  <TableTd align="right">
                    <ActionButton
                      action={removeSuppressionAction}
                      args={[x.email]}
                      size="compact-xs"
                      variant="subtle"
                      confirm={{ title: `Unblock ${x.email}?`, body: 'BluePrint will email this address again.', confirmLabel: 'Unblock' }}
                    >
                      Unblock
                    </ActionButton>
                  </TableTd>
                </TableTr>
              ))}
            </TableTbody>
          </Table>
        ) : (
          <Text fz="sm" c="dimmed">
            No blocked addresses.
          </Text>
        )}
      </Paper>

      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <Paper withBorder p="md">
          <Title order={2} fz="md" mb="sm">
            Scheduled jobs
          </Title>
          {s.jobs.length ? (
            <Table fz="sm">
              <TableThead>
                <TableTr>
                  <TableTh>Job</TableTh>
                  <TableTh>Started</TableTh>
                  <TableTh>Result</TableTh>
                </TableTr>
              </TableThead>
              <TableTbody>
                {s.jobs.map((j) => (
                  <TableTr key={j.id}>
                    <TableTd>{j.job}</TableTd>
                    <TableTd>{dateTime(j.startedAt)}</TableTd>
                    <TableTd>
                      <StatusBadge status={j.status} />
                    </TableTd>
                  </TableTr>
                ))}
              </TableTbody>
            </Table>
          ) : (
            <Text fz="sm" c="dimmed">
              No jobs have run yet.
            </Text>
          )}
        </Paper>
        <Paper withBorder p="md">
          <Title order={2} fz="md" mb="sm">
            Payment events with errors
          </Title>
          {s.webhookErrors.length ? (
            <Table fz="sm">
              <TableThead>
                <TableTr>
                  <TableTh>Received</TableTh>
                  <TableTh>Event</TableTh>
                  <TableTh>Error</TableTh>
                </TableTr>
              </TableThead>
              <TableTbody>
                {s.webhookErrors.map((w) => (
                  <TableTr key={w.id}>
                    <TableTd>{dateTime(w.receivedAt)}</TableTd>
                    <TableTd>{w.type}</TableTd>
                    <TableTd>
                      <Text fz="xs" c="red" lineClamp={2}>
                        {w.error}
                      </Text>
                    </TableTd>
                  </TableTr>
                ))}
              </TableTbody>
            </Table>
          ) : (
            <Text fz="sm" c="dimmed">
              None.
            </Text>
          )}
        </Paper>
      </SimpleGrid>
    </Stack>
  );
}
