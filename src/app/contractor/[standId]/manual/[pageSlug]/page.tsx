import { notFound } from 'next/navigation';
import { Paper, Stack, Title } from '@mantine/core';
import { TextLink } from '@/components/links';
import { RichHtml } from '@/components/rich-html';
import { requireActor } from '@/server/auth/current';
import { packView } from '@/server/services/space-only';
import { pageForType } from '@/server/services/manual';
import { AppError } from '@/server/errors';

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
  return (
    <Stack maw={860}>
      <TextLink href={`/contractor/${standId}`} fz="sm">
        ← Stand {view.stand.number}
      </TextLink>
      <Title order={1} fz={26}>
        {page.title}
      </Title>
      <Paper withBorder p="lg">
        <RichHtml html={page.bodyHtml} />
      </Paper>
    </Stack>
  );
}
