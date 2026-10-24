import { notFound } from 'next/navigation';
import { Stack } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { getPage, listPages } from '@/server/services/manual';
import { listExhibitorTypes } from '@/server/services/show-setup';
import { AppError } from '@/server/errors';
import { loadEdition } from '../../load';
import { PageEditor } from './page-editor';

export default async function EditManualPage({ params }: PageProps<'/manage/[editionId]/manual/[pageId]'>) {
  const { editionId, pageId } = await params;
  const { actor, edition } = await loadEdition(editionId, 'edit_content');
  const isNew = pageId === 'new';
  if (!isNew && !/^[0-9a-f-]{36}$/i.test(pageId)) notFound();
  let page: Awaited<ReturnType<typeof getPage>> | null = null;
  if (!isNew) {
    try {
      page = await getPage(actor, pageId);
    } catch (err) {
      if (err instanceof AppError) notFound();
      throw err;
    }
    if (page.editionId !== edition.id) notFound();
  }
  const [types, pages] = await Promise.all([listExhibitorTypes(actor, edition.id), listPages(actor, edition.id)]);
  return (
    <Stack>
      <PageHeader eyebrow="Exhibitor manual" title={page ? page.title : 'New page'} />
      <PageEditor
        editionId={edition.id}
        pageId={page?.id ?? null}
        initial={{
          title: page?.title ?? '',
          bodyHtml: page?.bodyHtml ?? '',
          visibleToTypes: page?.visibleToTypes ?? [],
          published: page?.published ?? false,
          pinned: page?.pinned ?? false,
          parentId: page?.parentId ?? null,
        }}
        types={types.map((t) => ({ value: t.id, label: t.name }))}
        sections={pages.filter((p) => !p.parentId && p.id !== page?.id).map((p) => ({ value: p.id, label: p.title }))}
        canSaveToLibrary={actor.isSuperAdmin && !actor.readOnly}
      />
    </Stack>
  );
}
