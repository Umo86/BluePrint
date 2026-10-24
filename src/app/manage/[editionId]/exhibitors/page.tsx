import { Badge, Group, Paper, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { ButtonLink, TextLink } from '@/components/links';
import { ActionButton } from '@/components/action-button';
import { EXHIBITOR_FILTERS, listExhibitors, type InviteState } from '@/server/services/stands';
import { listExhibitorTypes, listHalls } from '@/server/services/show-setup';
import { dateShort, plural } from '@/lib/format';
import { sendUnsentInvitesAction } from '../../actions';
import { loadEdition } from '../load';
import { AddExhibitorButton, ExhibitorFilters } from './exhibitor-controls';

const STATE: Record<InviteState, { label: string; color: string }> = {
  joined: { label: 'Signed up', color: 'green' },
  invited: { label: 'Invited', color: 'blue' },
  not_sent: { label: 'Invitation not sent', color: 'yellow' },
  no_contact: { label: 'No contact yet', color: 'gray' },
};

function one(v: string | string[] | undefined) {
  return typeof v === 'string' ? v.slice(0, 200) : undefined;
}

export default async function ExhibitorsPage({ params, searchParams }: PageProps<'/manage/[editionId]/exhibitors'>) {
  const { editionId } = await params;
  const { actor, edition, access } = await loadEdition(editionId);
  const sp = await searchParams;
  const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
  const state = (EXHIBITOR_FILTERS as readonly string[]).includes(one(sp.state) ?? '') ? (one(sp.state) as (typeof EXHIBITOR_FILTERS)[number]) : 'all';
  const [{ rows, summary }, types, halls] = await Promise.all([
    listExhibitors(actor, edition.id, { q: one(sp.q), typeId: uuid(one(sp.type)), hallId: uuid(one(sp.hall)), state }),
    listExhibitorTypes(actor, edition.id),
    listHalls(actor, edition.id),
  ]);
  const canManage = access.permissions.has('manage_exhibitors');
  const base = `/manage/${edition.id}`;
  return (
    <Stack>
      <PageHeader
        title="Exhibitors"
        description={`${plural(summary.companies, 'company', 'companies')} exhibiting. ${summary.joined} signed up, ${summary.invited} invited, ${summary.notSent} invitations not sent yet, ${summary.noContact} with no contact.`}
        actions={
          canManage ? (
            <Group gap="xs">
              {summary.notSent ? (
                <ActionButton
                  action={sendUnsentInvitesAction}
                  args={[edition.id]}
                  variant="light"
                  confirm={{
                    title: `Send ${plural(summary.notSent, 'invitation')}?`,
                    body: 'Each saved contact gets an email with their personal link to BluePrint.',
                    confirmLabel: 'Send invitations',
                  }}
                >
                  Send {plural(summary.notSent, 'saved invitation')}
                </ActionButton>
              ) : null}
              <ButtonLink href={`${base}/exhibitors/import`} variant="default">
                Import
              </ButtonLink>
              <AddExhibitorButton
                editionId={edition.id}
                types={types.map((t) => ({ value: t.id, label: t.name }))}
                halls={halls.map((h) => ({ value: h.id, label: h.name }))}
                isDraft={edition.status === 'draft'}
              />
            </Group>
          ) : null
        }
      />
      <ExhibitorFilters
        types={types.map((t) => ({ value: t.id, label: `${t.name} (${t.standCount})` }))}
        halls={halls.map((h) => ({ value: h.id, label: h.name }))}
        counts={{ all: summary.companies, joined: summary.joined, invited: summary.invited, not_sent: summary.notSent, no_contact: summary.noContact }}
      />
      <Paper withBorder>
        <Table verticalSpacing="sm" highlightOnHover>
          <TableThead>
            <TableTr>
              <TableTh>Company</TableTh>
              <TableTh>Stand</TableTh>
              <TableTh>Main contact</TableTh>
              <TableTh>BluePrint</TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {rows.map((r) => (
              <TableTr key={r.company.id}>
                <TableTd>
                  <TextLink href={`${base}/exhibitors/${r.company.id}`} fw={600} fz="sm">
                    {r.company.name}
                  </TextLink>
                </TableTd>
                <TableTd>
                  <Stack gap={2}>
                    {r.stands.map((s) => (
                      <Group key={s.id} gap={6} wrap="nowrap">
                        <Text fz="sm" fw={600}>
                          {s.number}
                        </Text>
                        <Badge size="xs" variant="light" color={s.isSpaceOnly ? 'orange' : 'blue'}>
                          {s.typeName}
                        </Badge>
                        {s.hallName ? (
                          <Text fz="xs" c="dimmed">
                            {s.hallName}
                          </Text>
                        ) : null}
                      </Group>
                    ))}
                  </Stack>
                </TableTd>
                <TableTd>
                  {r.mainContact ? (
                    <>
                      <Text fz="sm">{r.mainContact.name || r.mainContact.email}</Text>
                      <Text fz="xs" c="dimmed">
                        {r.mainContact.email}
                      </Text>
                    </>
                  ) : r.invite ? (
                    <Text fz="sm" c="dimmed">
                      {r.invite.email}
                    </Text>
                  ) : (
                    <Text fz="sm" c="dimmed">
                      —
                    </Text>
                  )}
                </TableTd>
                <TableTd>
                  <Badge variant="light" color={STATE[r.state].color}>
                    {STATE[r.state].label}
                  </Badge>
                  <Text fz="xs" c="dimmed" mt={2}>
                    {r.state === 'joined'
                      ? r.lastLoginAt
                        ? `Last seen ${dateShort(r.lastLoginAt)}`
                        : 'Not signed in yet'
                      : r.state === 'invited' && r.invite?.sentAt
                        ? `Sent ${dateShort(r.invite.sentAt)}`
                        : ''}
                  </Text>
                </TableTd>
              </TableTr>
            ))}
          </TableTbody>
        </Table>
        {rows.length === 0 ? (
          <Text p="md" c="dimmed" fz="sm">
            {summary.companies ? 'No exhibitors match these filters.' : 'No exhibitors yet. Add them one by one or import a spreadsheet.'}
          </Text>
        ) : null}
      </Paper>
    </Stack>
  );
}
