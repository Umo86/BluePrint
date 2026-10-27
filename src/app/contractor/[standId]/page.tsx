import { notFound } from 'next/navigation';
import { Group, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { TextLink } from '@/components/links';
import { SpaceOnlyPack } from '@/components/space-only-pack';
import { requireActor } from '@/server/auth/current';
import { packView } from '@/server/services/space-only';
import { pagesForType } from '@/server/services/manual';
import { AppError } from '@/server/errors';
import { dateTime, standSize } from '@/lib/format';
import { toPackProps } from '@/app/space-only-props';
import { ShowContacts } from '@/components/show-contacts';
import { DemoFrame } from '@/components/demo-frame';

export default async function ContractorStand({ params }: PageProps<'/contractor/[standId]'>) {
  const { standId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(standId)) notFound();
  const actor = await requireActor();
  let view: Awaited<ReturnType<typeof packView>>;
  try {
    view = await packView(actor, standId);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
  const pages = await pagesForType(view.edition.id, view.stand.exhibitorTypeId);
  return (
    <DemoFrame editionId={view.edition.id}>
      <Stack maw={960}>
        <TextLink href="/contractor" fz="sm">
          ← Your stands
        </TextLink>
        <div>
          <Title order={1} fz={30}>
            Stand {view.stand.number} · {view.company.name}
          </Title>
          <Text c="dimmed">
            {view.edition.name}
            {view.hall ? ` · hall ${view.hall.name}` : ''}
            {standSize(view.stand) ? ` · ${standSize(view.stand)}` : ''}
          </Text>
        </div>
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <Paper withBorder p="md">
            <Text fz="sm" fw={500} c="dimmed">
              Build-up and breakdown
            </Text>
            <Text fz="sm">Build-up starts {view.edition.buildUpStartsAt ? dateTime(view.edition.buildUpStartsAt) : 'to be confirmed'}</Text>
            <Text fz="sm">Breakdown ends {view.edition.breakdownEndsAt ? dateTime(view.edition.breakdownEndsAt) : 'to be confirmed'}</Text>
          </Paper>
          <Paper withBorder p="md">
            <Text fz="sm" fw={500} c="dimmed">
              Rules for building
            </Text>
            <Group gap="sm" mt={4}>
              {pages.filter((p) => !p.parentId).map((p) => (
                <TextLink key={p.id} href={`/contractor/${standId}/manual/${p.slug}`} fz="sm">
                  {p.title}
                </TextLink>
              ))}
              {!pages.length ? (
                <Text fz="sm" c="dimmed">
                  The show team has not published build rules yet.
                </Text>
              ) : null}
            </Group>
          </Paper>
        </SimpleGrid>
        <ShowContacts contacts={view.edition.contacts} title="Show contacts" />
        <SpaceOnlyPack {...toPackProps(view)} />
      </Stack>
    </DemoFrame>
  );
}
