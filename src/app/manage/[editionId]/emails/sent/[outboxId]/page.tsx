import { Group, Paper, Stack, Table, TableTbody, TableTd, TableTr, Text } from '@mantine/core';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { TextLink } from '@/components/links';
import { emailDetail } from '@/server/services/email-admin';
import { AppError } from '@/server/errors';
import { dateTime } from '@/lib/format';
import { loadEdition } from '../../../load';

export default async function SentEmail({ params }: PageProps<'/manage/[editionId]/emails/sent/[outboxId]'>) {
  const { editionId, outboxId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(outboxId)) notFound();
  const { actor, edition } = await loadEdition(editionId, 'send_emails');
  let d: Awaited<ReturnType<typeof emailDetail>>;
  try {
    d = await emailDetail(actor, edition.id, outboxId);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
  const tz = edition.timezone;
  return (
    <Stack>
      <TextLink href={`/manage/${edition.id}/emails?tab=sent`} fz="sm">
        ← Sent emails
      </TextLink>
      <PageHeader title={d.mail.subject} description={`To ${d.mail.toEmail} · ${dateTime(d.mail.createdAt, tz)}`} actions={<StatusBadge status={d.mail.status} />} />
      <Group align="flex-start" grow>
        <Paper withBorder p="md" maw={360}>
          <Table variant="vertical">
            <TableTbody>
              <TableTr>
                <TableTd fw={600}>From</TableTd>
                <TableTd>{d.mail.fromAddress}</TableTd>
              </TableTr>
              <TableTr>
                <TableTd fw={600}>Type</TableTd>
                <TableTd>{d.mail.category}</TableTd>
              </TableTr>
              {d.mail.error ? (
                <TableTr>
                  <TableTd fw={600}>Problem</TableTd>
                  <TableTd>{d.mail.error}</TableTd>
                </TableTr>
              ) : null}
            </TableTbody>
          </Table>
          <Text fz="sm" fw={600} mt="md">
            Delivery
          </Text>
          {d.events.length ? (
            d.events.map((e) => (
              <Text key={e.id} fz="xs">
                {dateTime(e.at, tz)}: {e.type}
              </Text>
            ))
          ) : (
            <Text fz="xs" c="dimmed">
              No delivery reports yet.
            </Text>
          )}
        </Paper>
        <Paper withBorder p={0}>
          <iframe title="The email as sent" sandbox="" srcDoc={d.mail.html} style={{ width: '100%', height: 700, border: 0 }} />
        </Paper>
      </Group>
    </Stack>
  );
}
