import { notFound } from 'next/navigation';
import { desc } from 'drizzle-orm';
import { Badge, Container, Paper, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, Title } from '@mantine/core';
import { getDb } from '@/server/db/client';
import { emailOutbox } from '@/server/db/schema';
import { devMailboxEnabled } from '@/server/dev';

/** Local development only: shows emails BluePrint would have sent, including sign-in codes. */
export default async function DevMailbox() {
  if (!devMailboxEnabled()) notFound();
  const db = await getDb();
  const rows = await db.select().from(emailOutbox).orderBy(desc(emailOutbox.createdAt)).limit(50);
  return (
    <Container size="lg" py="xl">
      <Stack>
        <Title order={1} fz={24}>
          Development mailbox
        </Title>
        <Text c="dimmed" fz="sm">
          Only available on a local machine. Real deployments send through Resend and this page does not exist.
        </Text>
        <Paper withBorder>
          <Table>
            <TableThead>
              <TableTr>
                <TableTh>To</TableTh>
                <TableTh>Subject</TableTh>
                <TableTh>Status</TableTh>
                <TableTh>Sent</TableTh>
              </TableTr>
            </TableThead>
            <TableTbody>
              {rows.map((r) => (
                <TableTr key={r.id}>
                  <TableTd>{r.toEmail}</TableTd>
                  <TableTd>
                    <a href={`/dev/mailbox/${r.id}`} data-testid="mail-subject">
                      {r.subject}
                    </a>
                  </TableTd>
                  <TableTd>
                    <Badge variant="light">{r.status}</Badge>
                  </TableTd>
                  <TableTd>{r.createdAt.toLocaleString('en-GB')}</TableTd>
                </TableTr>
              ))}
            </TableTbody>
          </Table>
        </Paper>
      </Stack>
    </Container>
  );
}
