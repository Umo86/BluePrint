import { Badge, Group, Paper, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { ButtonLink, TextLink } from '@/components/links';
import { listPages } from '@/server/services/manual';
import { listExhibitorTypes } from '@/server/services/show-setup';
import { listLibrary } from '@/server/services/library';
import { dateShort } from '@/lib/format';
import { loadEdition } from '../load';
import { FromLibraryButton, PageRowActions } from './manual-controls';

export default async function ManualPages({ params }: PageProps<'/manage/[editionId]/manual'>) {
  const { editionId } = await params;
  const { actor, edition, access } = await loadEdition(editionId);
  const [pages, types, library] = await Promise.all([listPages(actor, edition.id), listExhibitorTypes(actor, edition.id), listLibrary(actor, 'page')]);
  const canEdit = access.permissions.has('edit_content');
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const top = pages.filter((p) => !p.parentId);
  const ordered = top.flatMap((p) => [p, ...pages.filter((c) => c.parentId === p.id)]);
  const orphans = pages.filter((p) => p.parentId && !pages.some((x) => x.id === p.parentId));
  const base = `/manage/${edition.id}/manual`;
  return (
    <Stack>
      <PageHeader
        title="Exhibitor manual"
        description="The pages exhibitors read: rules, deliveries, venue information and so on. Each page can be shown to every stand type or only some."
        actions={
          canEdit ? (
            <Group gap="xs">
              {library.length ? <FromLibraryButton editionId={edition.id} kind="page" items={library.map((l) => ({ value: l.id, label: l.name }))} /> : null}
              <ButtonLink href={`${base}/new`}>New page</ButtonLink>
            </Group>
          ) : null
        }
      />
      <Paper withBorder>
        <Table verticalSpacing="sm">
          <TableThead>
            <TableTr>
              <TableTh>Page</TableTh>
              <TableTh>Shown to</TableTh>
              <TableTh>Updated</TableTh>
              {canEdit ? <TableTh w={150} /> : null}
            </TableTr>
          </TableThead>
          <TableTbody>
            {[...ordered, ...orphans].map((p) => (
              <TableTr key={p.id}>
                <TableTd pl={p.parentId ? 40 : undefined}>
                  <Group gap={6}>
                    {canEdit ? (
                      <TextLink href={`${base}/${p.id}`} fw={600} fz="sm">
                        {p.title}
                      </TextLink>
                    ) : (
                      <Text fw={600} fz="sm">
                        {p.title}
                      </Text>
                    )}
                    {!p.published ? (
                      <Badge size="xs" color="gray" variant="light">
                        Draft
                      </Badge>
                    ) : null}
                    {p.pinned ? (
                      <Badge size="xs" color="yellow" variant="light">
                        Pinned
                      </Badge>
                    ) : null}
                  </Group>
                </TableTd>
                <TableTd>
                  <Text fz="sm">{p.visibleToTypes.length ? p.visibleToTypes.map((t) => typeName.get(t) ?? '?').join(', ') : 'Everyone'}</Text>
                </TableTd>
                <TableTd>{dateShort(p.updatedAt)}</TableTd>
                {canEdit ? (
                  <TableTd>
                    <PageRowActions editionId={edition.id} pageId={p.id} title={p.title} />
                  </TableTd>
                ) : null}
              </TableTr>
            ))}
          </TableTbody>
        </Table>
        {pages.length === 0 ? (
          <Text p="md" c="dimmed" fz="sm">
            No pages yet. Start with a new page{library.length ? ' or copy one from the library' : ''}.
          </Text>
        ) : null}
      </Paper>
    </Stack>
  );
}
