import { Badge, Group, Paper, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { ButtonLink, TextLink } from '@/components/links';
import { listAnnouncements } from '@/server/services/announcements';
import { listExhibitorTypes } from '@/server/services/show-setup';
import { dateTime } from '@/lib/format';
import { loadEdition } from '../load';
import { AnnouncementRowActions } from './announcement-controls';

const STATE = {
  draft: { label: 'Not published', color: 'gray' },
  scheduled: { label: 'Scheduled', color: 'blue' },
  published: { label: 'On the portal', color: 'green' },
} as const;

export default async function Announcements({ params }: PageProps<'/manage/[editionId]/announcements'>) {
  const { editionId } = await params;
  const { actor, edition, access } = await loadEdition(editionId);
  const [rows, types] = await Promise.all([listAnnouncements(actor, edition.id), listExhibitorTypes(actor, edition.id)]);
  const canEdit = access.permissions.has('edit_content') && !actor.readOnly;
  const canEmail = access.permissions.has('send_emails') && !actor.readOnly;
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const base = `/manage/${edition.id}/announcements`;
  return (
    <Stack>
      <PageHeader
        title="Announcements"
        description="Short notices on the exhibitor portal’s home page, such as a change to build-up times. Pinned ones stay at the top. You can also email an announcement to the same exhibitors."
        actions={canEdit ? <ButtonLink href={`${base}/new`}>New announcement</ButtonLink> : null}
      />
      <Paper withBorder>
        <Table verticalSpacing="sm">
          <TableThead>
            <TableTr>
              <TableTh>Announcement</TableTh>
              <TableTh>Shown to</TableTh>
              <TableTh>Status</TableTh>
              {canEdit || canEmail ? <TableTh w={170} /> : null}
            </TableTr>
          </TableThead>
          <TableTbody>
            {rows.map((a) => (
              <TableTr key={a.id}>
                <TableTd>
                  <Group gap={6}>
                    {canEdit ? (
                      <TextLink href={`${base}/${a.id}`} fw={600} fz="sm">
                        {a.title}
                      </TextLink>
                    ) : (
                      <Text fw={600} fz="sm">
                        {a.title}
                      </Text>
                    )}
                    {a.pinned ? (
                      <Badge size="xs" color="yellow" variant="light">
                        Pinned
                      </Badge>
                    ) : null}
                  </Group>
                </TableTd>
                <TableTd>
                  <Text fz="sm">{a.visibleToTypes.length ? a.visibleToTypes.map((t) => typeName.get(t) ?? '?').join(', ') : 'Every stand type'}</Text>
                </TableTd>
                <TableTd>
                  <Badge variant="light" color={STATE[a.state].color}>
                    {STATE[a.state].label}
                  </Badge>
                  {a.publishedAt ? (
                    <Text fz="xs" c="dimmed" mt={2}>
                      {a.state === 'scheduled' ? `From ${dateTime(a.publishedAt)}` : `Since ${dateTime(a.publishedAt)}`}
                    </Text>
                  ) : null}
                </TableTd>
                {canEdit || canEmail ? (
                  <TableTd>
                    <AnnouncementRowActions editionId={edition.id} announcementId={a.id} title={a.title} state={a.state} canEdit={canEdit} canEmail={canEmail} />
                  </TableTd>
                ) : null}
              </TableTr>
            ))}
          </TableTbody>
        </Table>
        {rows.length === 0 ? (
          <Text p="md" c="dimmed" fz="sm">
            No announcements yet.
          </Text>
        ) : null}
      </Paper>
    </Stack>
  );
}
