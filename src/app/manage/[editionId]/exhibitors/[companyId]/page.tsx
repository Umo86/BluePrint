import { notFound } from 'next/navigation';
import { Badge, Code, Group, Paper, SimpleGrid, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, Title } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { ActionButton } from '@/components/action-button';
import { TextLink } from '@/components/links';
import { getExhibitor } from '@/server/services/stands';
import { listExhibitorTypes, listHalls } from '@/server/services/show-setup';
import { AppError } from '@/server/errors';
import { dateShort, dateTime } from '@/lib/format';
import { resendInvitationAction, revokeInvitationAction } from '@/app/admin/actions';
import { deleteNoteAction } from '../../../actions';
import { loadEdition } from '../../load';
import { CompanyForm, EditStandButton, InviteContactForm, MemberActions, NoteForm, ViewAsButton } from './exhibitor-detail-controls';

const INVITE_KIND: Record<string, string> = { exhibitor: 'Exhibitor', colleague: 'Colleague', contractor: 'Stand contractor' };

export default async function ExhibitorPage({ params }: PageProps<'/manage/[editionId]/exhibitors/[companyId]'>) {
  const { editionId, companyId } = await params;
  const { actor, edition, isAdmin } = await loadEdition(editionId);
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) notFound();
  let d: Awaited<ReturnType<typeof getExhibitor>>;
  try {
    d = await getExhibitor(actor, edition.id, companyId);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
  const [types, halls] = d.canManage ? await Promise.all([listExhibitorTypes(actor, edition.id), listHalls(actor, edition.id)]) : [[], []];
  const typeOptions = types.map((t) => ({ value: t.id, label: t.name }));
  const hallOptions = halls.map((h) => ({ value: h.id, label: h.name }));
  const c = d.company;
  return (
    <Stack>
      <PageHeader
        eyebrow="Exhibitor"
        title={c.name}
        description={c.website ?? undefined}
        actions={
          <Group gap="xs">
            {d.stands.map((s) => (
              <Badge key={s.stand.id} size="lg" variant="light" color={s.type.isSpaceOnly ? 'orange' : 'blue'}>
                {s.stand.number} · {s.type.name}
              </Badge>
            ))}
            {isAdmin && d.members.length ? <ViewAsButton editionId={edition.id} members={d.members.map((m) => ({ id: m.user.id, name: m.user.name || m.user.email }))} /> : null}
          </Group>
        }
      />

      <Paper withBorder p="md">
        <Title order={2} fz="md" mb="sm">
          Stands at this show
        </Title>
        <Table>
          <TableThead>
            <TableTr>
              <TableTh>Stand</TableTh>
              <TableTh>Type</TableTh>
              <TableTh>Hall</TableTh>
              <TableTh>Size</TableTh>
              <TableTh>Open sides</TableTh>
              <TableTh>Contractor</TableTh>
              <TableTh>Status</TableTh>
              {d.canManage ? <TableTh /> : null}
            </TableTr>
          </TableThead>
          <TableTbody>
            {d.stands.map((s) => (
              <TableTr key={s.stand.id}>
                <TableTd fw={600}>{s.stand.number}</TableTd>
                <TableTd>{s.type.name}</TableTd>
                <TableTd>{s.hall?.name ?? '—'}</TableTd>
                <TableTd>{s.stand.sizeSqm ? `${Number(s.stand.sizeSqm)} sqm` : '—'}</TableTd>
                <TableTd>{s.stand.openSides}</TableTd>
                <TableTd>{s.type.isSpaceOnly ? (s.contractor && s.contractor.status !== 'removed' ? `${s.contractor.contractorCompanyName} (${s.contractor.contactEmail})` : 'Not nominated yet') : '—'}</TableTd>
                <TableTd>
                  <StatusBadge status={s.stand.status} />
                </TableTd>
                {d.canManage ? (
                  <TableTd>
                    <EditStandButton
                      editionId={edition.id}
                      standId={s.stand.id}
                      initial={{
                        number: s.stand.number,
                        exhibitorTypeId: s.stand.exhibitorTypeId,
                        hallId: s.stand.hallId,
                        sizeSqm: s.stand.sizeSqm === null ? null : Number(s.stand.sizeSqm),
                        openSides: s.stand.openSides,
                        notes: s.stand.notes ?? '',
                      }}
                      types={typeOptions}
                      halls={hallOptions}
                      status={s.stand.status}
                    />
                  </TableTd>
                ) : null}
              </TableTr>
            ))}
          </TableTbody>
        </Table>
      </Paper>

      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <Stack>
          <Paper withBorder p="md">
            <Title order={2} fz="md" mb="sm">
              People ({d.members.length})
            </Title>
            {d.members.length ? (
              <Table>
                <TableThead>
                  <TableTr>
                    <TableTh>Name</TableTh>
                    <TableTh>Role</TableTh>
                    <TableTh>Last signed in</TableTh>
                    {d.canManage ? <TableTh w={40} /> : null}
                  </TableTr>
                </TableThead>
                <TableTbody>
                  {d.members.map((m) => (
                    <TableTr key={m.user.id}>
                      <TableTd>
                        <Text fz="sm" fw={600}>
                          {m.user.name || m.user.email}
                        </Text>
                        <Text fz="xs" c="dimmed">
                          {m.user.email}
                          {m.user.phone ? ` · ${m.user.phone}` : ''}
                        </Text>
                      </TableTd>
                      <TableTd>
                        {m.role === 'main_contact' ? <Badge variant="light">Main contact</Badge> : 'Colleague'}
                        {!m.canPay && m.role !== 'main_contact' ? (
                          <Text fz="xs" c="dimmed">
                            Cannot pay
                          </Text>
                        ) : null}
                      </TableTd>
                      <TableTd>{m.user.lastLoginAt ? dateShort(m.user.lastLoginAt) : 'Never'}</TableTd>
                      {d.canManage ? (
                        <TableTd>
                          <MemberActions companyId={c.id} member={{ userId: m.user.id, name: m.user.name || m.user.email, role: m.role, canPay: m.canPay }} />
                        </TableTd>
                      ) : null}
                    </TableTr>
                  ))}
                </TableTbody>
              </Table>
            ) : (
              <Text fz="sm" c="dimmed">
                Nobody from this company has signed up yet.
              </Text>
            )}
            {d.canManage ? <InviteContactForm editionId={edition.id} companyId={c.id} hasMainContact={d.members.some((m) => m.role === 'main_contact')} isDraft={edition.status === 'draft'} /> : null}
          </Paper>

          {d.invites.length ? (
            <Paper withBorder p="md">
              <Title order={2} fz="md" mb="sm">
                Invitations not yet accepted
              </Title>
              <Table>
                <TableThead>
                  <TableTr>
                    <TableTh>Email</TableTh>
                    <TableTh>For</TableTh>
                    <TableTh>Sent</TableTh>
                    {d.canManage ? <TableTh /> : null}
                  </TableTr>
                </TableThead>
                <TableTbody>
                  {d.invites.map((inv) => (
                    <TableTr key={inv.id}>
                      <TableTd>{inv.email}</TableTd>
                      <TableTd>
                        {INVITE_KIND[inv.kind] ?? inv.kind}
                        {inv.kind === 'exhibitor' && inv.role === 'colleague' ? ' (colleague)' : ''}
                      </TableTd>
                      <TableTd>{inv.lastSentAt ? dateShort(inv.lastSentAt) : <Badge color="yellow" variant="light">Not sent</Badge>}</TableTd>
                      {d.canManage ? (
                        <TableTd>
                          <Group gap="xs" justify="flex-end" wrap="nowrap">
                            <ActionButton action={resendInvitationAction} args={[inv.id]} size="compact-xs" variant="light" disabled={edition.status === 'draft'}>
                              {inv.lastSentAt ? 'Send again' : 'Send'}
                            </ActionButton>
                            <ActionButton action={revokeInvitationAction} args={[inv.id]} size="compact-xs" variant="subtle" color="red">
                              Cancel
                            </ActionButton>
                          </Group>
                        </TableTd>
                      ) : null}
                    </TableTr>
                  ))}
                </TableTbody>
              </Table>
            </Paper>
          ) : null}

          <Paper withBorder p="md">
            <Title order={2} fz="md" mb={4}>
              Internal notes
            </Title>
            <Text fz="xs" c="dimmed" mb="sm">
              Only the show team sees these.
            </Text>
            <Stack gap="sm">
              {d.notes.map((n) => (
                <Paper key={n.note.id} withBorder p="sm" bg="var(--mantine-color-gray-0)">
                  <Text fz="sm" style={{ whiteSpace: 'pre-wrap' }}>
                    {n.note.body}
                  </Text>
                  <Group justify="space-between" mt={4}>
                    <Text fz="xs" c="dimmed">
                      {n.author?.name || n.author?.email || 'Someone'} · {dateTime(n.note.createdAt)}
                    </Text>
                    {n.note.authorId === actor.realUserId || isAdmin ? (
                      <ActionButton action={deleteNoteAction} args={[edition.id, n.note.id]} size="compact-xs" variant="subtle" color="red" confirm={{ title: 'Delete this note?', confirmLabel: 'Delete', danger: true }}>
                        Delete
                      </ActionButton>
                    ) : null}
                  </Group>
                </Paper>
              ))}
              {!d.notes.length ? (
                <Text fz="sm" c="dimmed">
                  No notes yet.
                </Text>
              ) : null}
              {d.canNote ? <NoteForm editionId={edition.id} companyId={c.id} /> : null}
            </Stack>
          </Paper>
        </Stack>

        <Stack>
          {d.canManage ? (
            <CompanyForm
              editionId={edition.id}
              companyId={c.id}
              initial={{
                name: c.name,
                website: c.website ?? '',
                email: c.email ?? '',
                phone: c.phone ?? '',
                description: c.description ?? '',
                addressLine1: c.addressLine1 ?? '',
                addressLine2: c.addressLine2 ?? '',
                city: c.city ?? '',
                postcode: c.postcode ?? '',
                country: c.country ?? '',
                vatNumber: c.vatNumber ?? '',
                aspExhibitorId: c.aspExhibitorId ?? '',
              }}
            />
          ) : (
            <Paper withBorder p="md">
              <Title order={2} fz="md" mb="sm">
                Company details
              </Title>
              <Text fz="sm">{[c.addressLine1, c.addressLine2, c.city, c.postcode, c.country].filter(Boolean).join(', ') || 'No address yet'}</Text>
              <Text fz="sm">{[c.email, c.phone].filter(Boolean).join(' · ')}</Text>
              {c.vatNumber ? <Text fz="sm">VAT {c.vatNumber}</Text> : null}
            </Paper>
          )}
          <Paper withBorder p="md">
            <Title order={2} fz="md" mb="sm">
              Emails sent
            </Title>
            {d.emails.length ? (
              <Table fz="xs">
                <TableTbody>
                  {d.emails.map((m) => (
                    <TableTr key={m.id}>
                      <TableTd style={{ whiteSpace: 'nowrap' }}>{dateTime(m.createdAt)}</TableTd>
                      <TableTd>
                        {d.canOpenEmails ? (
                          <TextLink href={`/manage/${edition.id}/emails/sent/${m.id}`} fz="xs">
                            {m.subject}
                          </TextLink>
                        ) : (
                          m.subject
                        )}
                        <Text fz="xs" c="dimmed">
                          {m.toEmail}
                        </Text>
                      </TableTd>
                      <TableTd>
                        <StatusBadge status={m.status} />
                      </TableTd>
                    </TableTr>
                  ))}
                </TableTbody>
              </Table>
            ) : (
              <Text fz="sm" c="dimmed">
                None yet.
              </Text>
            )}
          </Paper>
          <Paper withBorder p="md">
            <Title order={2} fz="md" mb="sm">
              Activity
            </Title>
            {d.activity.length ? (
              <Table fz="xs">
                <TableTbody>
                  {d.activity.map((a) => (
                    <TableTr key={a.id}>
                      <TableTd style={{ whiteSpace: 'nowrap' }}>{dateTime(a.at)}</TableTd>
                      <TableTd>{a.actorEmail ?? 'System'}</TableTd>
                      <TableTd>
                        <Code fz="xs">{a.action}</Code>
                      </TableTd>
                    </TableTr>
                  ))}
                </TableTbody>
              </Table>
            ) : (
              <Text fz="sm" c="dimmed">
                Nothing yet.
              </Text>
            )}
          </Paper>
        </Stack>
      </SimpleGrid>
    </Stack>
  );
}
