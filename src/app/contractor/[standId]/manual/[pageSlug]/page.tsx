import { notFound } from 'next/navigation';
import { Paper, Stack, Text, Title } from '@mantine/core';
import { TextLink } from '@/components/links';
import { RichHtml } from '@/components/rich-html';
import { ManualPager } from '@/components/manual-pager';
import { requireActor } from '@/server/auth/current';
import { packView } from '@/server/services/space-only';
import { pageForType, pagesForType } from '@/server/services/manual';
import { AppError } from '@/server/errors';
import { neighbours } from '@/lib/manual-order';

export default async function ContractorManualPage({ params }: PageProps<'/contractor/[standId]/manual/[pageSlug]'>) {
  const { standId, pageSlug } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(standId) || !/^[a-z0-9-]{1,120}$/.test(pageSlug)) notFound();
  const actor = await requireActor();
  let view: Awaited<ReturnType<typeof packView>>;
  try {
    view = await packView(actor, standId);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
  const page = await pageForType(view.edition.id, view.stand.exhibitorTypeId, pageSlug);
  if (!page) notFound();
  const all = await pagesForType(view.edition.id, view.stand.exhibitorTypeId);
  const children = all.filter((p) => p.parentId === page.id);
  const { previous, next } = neighbours(all, page.id);
  const base = `/contractor/${standId}/manual`;
  return (
    <Stack maw={860}>
      <TextLink href={`/contractor/${standId}`} fz="sm">
        ← Stand {view.stand.number}
      </TextLink>
      <Title order={1} fz={30}>
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
      <ManualPager base={base} previous={previous} next={next} />
    </Stack>
  );
}
