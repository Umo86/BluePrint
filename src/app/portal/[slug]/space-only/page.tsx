import { notFound } from 'next/navigation';
import { Stack, Text, Title } from '@mantine/core';
import { SpaceOnlyPack } from '@/components/space-only-pack';
import { packView } from '@/server/services/space-only';
import { AppError } from '@/server/errors';
import { dateTime } from '@/lib/format';
import { toPackProps } from '@/app/space-only-props';
import { loadPortal } from '../load';

export default async function SpaceOnlyPage({ params }: PageProps<'/portal/[slug]/space-only'>) {
  const { slug } = await params;
  const ctx = await loadPortal(slug);
  if (!ctx.stand.isSpaceOnly) notFound();
  let view: Awaited<ReturnType<typeof packView>>;
  try {
    view = await packView(ctx.actor, ctx.stand.id);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
  return (
    <Stack maw={900}>
      <div>
        <Title order={1} fz={26}>
          Space-only stand approval
        </Title>
        <Text c="dimmed">
          Stand {ctx.stand.number}: before build-up starts{ctx.edition.buildUpStartsAt ? ` on ${dateTime(ctx.edition.buildUpStartsAt)}` : ''}, the show team must approve your stand design and your contractor’s
          safety documents.
        </Text>
      </div>
      <SpaceOnlyPack {...toPackProps(view)} />
    </Stack>
  );
}
