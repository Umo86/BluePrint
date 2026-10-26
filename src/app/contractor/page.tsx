import { Badge, Paper, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, Title } from '@mantine/core';
import { TextLink } from '@/components/links';
import { requireActor } from '@/server/auth/current';
import { contractorStands } from '@/server/services/space-only';
import { dateShort } from '@/lib/format';
import { PACK_STATUS_LABELS } from '@/lib/space-only';

export default async function ContractorHome() {
  const actor = await requireActor();
  const rows = await contractorStands(actor);
  return (
    <Stack>
      <div>
        <Title order={1} fz={30}>
          Your stands
        </Title>
        <Text c="dimmed">The space-only stands you have been nominated to build. Send each stand’s pack for approval before build-up.</Text>
      </div>
      <Paper withBorder>
        <Table verticalSpacing="sm" highlightOnHover>
          <TableThead>
            <TableTr>
              <TableTh>Show</TableTh>
              <TableTh>Stand</TableTh>
              <TableTh>Exhibitor</TableTh>
              <TableTh>Build-up</TableTh>
              <TableTh>Approval</TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {rows.map((r) => {
              const s = PACK_STATUS_LABELS[r.pack?.status ?? 'not_started'];
              return (
                <TableTr key={r.stand.id}>
                  <TableTd>{r.edition.name}</TableTd>
                  <TableTd>
                    <TextLink href={`/contractor/${r.stand.id}`} fw={600}>
                      {r.stand.number}
                    </TextLink>
                  </TableTd>
                  <TableTd>{r.company?.name ?? '—'}</TableTd>
                  <TableTd>{dateShort(r.edition.buildUpStartsAt)}</TableTd>
                  <TableTd>
                    <Badge variant="light" color={s.color}>
                      {s.label}
                    </Badge>
                  </TableTd>
                </TableTr>
              );
            })}
          </TableTbody>
        </Table>
        {!rows.length ? (
          <Text p="md" c="dimmed" fz="sm">
            No stands at the moment.
          </Text>
        ) : null}
      </Paper>
    </Stack>
  );
}
