import { Badge, Group, Paper, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { SearchFilter } from '@/components/ui/list-controls';
import { LinkTabs } from '@/components/ui/link-tabs';
import { ButtonLink, TextLink } from '@/components/links';
import { QUEUE_FILTERS, helpdeskQueue } from '@/server/services/helpdesk';
import { dateTime } from '@/lib/format';
import { loadEdition } from '../load';

const STATUS = {
  open: { label: 'Waiting for the team', color: 'blue' },
  pending: { label: 'Waiting for the exhibitor', color: 'orange' },
  closed: { label: 'Closed', color: 'gray' },
} as const;

export default async function HelpDesk({ params, searchParams }: PageProps<'/manage/[editionId]/help-desk'>) {
  const { editionId } = await params;
  const sp = await searchParams;
  const { actor, edition } = await loadEdition(editionId, 'helpdesk');
  const status = QUEUE_FILTERS.find((f) => f === sp.status) ?? 'open';
  const mine = sp.filter === 'mine';
  const q = typeof sp.q === 'string' ? sp.q : '';
  const { rows, counts } = await helpdeskQueue(actor, edition.id, { status, mine, q });
  const base = `/manage/${edition.id}/help-desk`;
  const keep = (s: string) => {
    const u = new URLSearchParams();
    if (s !== 'open') u.set('status', s);
    if (mine) u.set('filter', 'mine');
    if (q) u.set('q', q);
    return u.size ? `${base}?${u}` : base;
  };
  return (
    <Stack>
      <PageHeader
        title="Help desk"
        description="Questions from exhibitors, sent from the portal or handed over by the assistant. Replies are emailed to the exhibitor; internal notes are not."
        actions={
          <ButtonLink href={`${base}/saved-replies`} variant="default">
            Saved replies
          </ButtonLink>
        }
      />
      <LinkTabs
        value={status}
        tabs={[
          { value: 'open', label: 'Waiting for the team', href: keep('open'), count: counts.open },
          { value: 'pending', label: 'Waiting for the exhibitor', href: keep('pending') },
          { value: 'closed', label: 'Closed', href: keep('closed') },
          { value: 'all', label: 'All', href: keep('all') },
        ]}
      />
      <SearchFilter
        placeholder="Subject, reference, company, stand or email"
        filterOptions={[
          { value: 'all', label: 'Everyone’s questions' },
          { value: 'mine', label: 'Assigned to me' },
        ]}
        filterLabel="Show"
      />
      <Paper withBorder>
        <Table verticalSpacing="sm" highlightOnHover>
          <TableThead>
            <TableTr>
              <TableTh>Question</TableTh>
              <TableTh>Exhibitor</TableTh>
              <TableTh>Last message</TableTh>
              <TableTh>Assigned to</TableTh>
              <TableTh>Status</TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {rows.map((r) => (
              <TableTr key={r.ticket.id}>
                <TableTd>
                  <TextLink href={`${base}/${r.ticket.id}`} fw={600} fz="sm">
                    {r.ticket.subject}
                  </TextLink>
                  <Group gap={6}>
                    <Text fz="xs" c="dimmed">
                      {r.ticket.number}
                    </Text>
                    {r.ticket.source === 'assistant' ? (
                      <Badge size="xs" variant="outline" color="grape">
                        From the assistant
                      </Badge>
                    ) : null}
                  </Group>
                </TableTd>
                <TableTd>
                  <Text fz="sm">{r.companyName ?? r.ticket.contactName ?? '—'}</Text>
                  <Text fz="xs" c="dimmed">
                    {r.standNumber ? `Stand ${r.standNumber}` : r.ticket.contactEmail}
                  </Text>
                </TableTd>
                <TableTd>
                  <Text fz="sm">{dateTime(r.ticket.lastMessageAt ?? r.ticket.createdAt)}</Text>
                  <Text fz="xs" c="dimmed">
                    {r.ticket.lastMessageBy === 'staff' ? 'From the team' : 'From the exhibitor'}
                  </Text>
                </TableTd>
                <TableTd>
                  <Text fz="sm" c={r.assigneeName ? undefined : 'dimmed'}>
                    {r.assigneeName ?? 'Nobody yet'}
                  </Text>
                </TableTd>
                <TableTd>
                  <Badge variant="light" color={STATUS[r.ticket.status].color}>
                    {STATUS[r.ticket.status].label}
                  </Badge>
                </TableTd>
              </TableTr>
            ))}
          </TableTbody>
        </Table>
        {rows.length === 0 ? (
          <Text p="md" c="dimmed" fz="sm">
            {status === 'open' ? 'Nothing waiting for the team.' : 'No questions here.'}
          </Text>
        ) : null}
      </Paper>
    </Stack>
  );
}
