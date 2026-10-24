import { notFound } from 'next/navigation';
import { Paper, Stack, Text, Title } from '@mantine/core';
import { TextLink } from '@/components/links';
import { RichHtml } from '@/components/rich-html';
import { pageForType, pagesForType } from '@/server/services/manual';
import { dateLong } from '@/lib/format';
import { loadPortal } from '../../load';

export default async function ManualPage({ params }: PageProps<'/portal/[slug]/manual/[pageSlug]'>) {
  const { slug, pageSlug } = await params;
  const ctx = await loadPortal(slug);
  if (!/^[a-z0-9-]{1,120}$/.test(pageSlug)) notFound();
  const page = await pageForType(ctx.edition.id, ctx.stand.typeId, pageSlug);
  if (!page) notFound();
  const all = await pagesForType(ctx.edition.id, ctx.stand.typeId);
  const children = all.filter((p) => p.parentId === page.id);
  const parent = page.parentId ? all.find((p) => p.id === page.parentId) : null;
  const base = `/portal/${ctx.edition.slug}/manual`;
  return (
    <Stack maw={860}>
      <TextLink href={parent ? `${base}/${parent.slug}` : base} fz="sm">
        ← {parent ? parent.title : 'Exhibitor manual'}
      </TextLink>
      <Title order={1} fz={26}>
        {page.title}
      </Title>
      <Paper withBorder p="lg">
        <RichHtml html={page.bodyHtml} />
        {!page.bodyHtml ? <Text c="dimmed">This page has no content yet.</Text> : null}
      </Paper>
      {children.length ? (
        <Paper withBorder p="md">
          <Text fw={600} mb={4}>
            In this section
          </Text>
          <Stack gap={2}>
            {children.map((c) => (
              <TextLink key={c.id} href={`${base}/${c.slug}`} fz="sm">
                {c.title}
              </TextLink>
            ))}
          </Stack>
        </Paper>
      ) : null}
      <Text fz="xs" c="dimmed">
        Last updated {dateLong(page.updatedAt)}
      </Text>
    </Stack>
  );
}
