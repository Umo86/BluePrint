import { Paper, Stack, Text, Title } from '@mantine/core';
import { TextLink } from '@/components/links';
import { pagesForType } from '@/server/services/manual';
import { loadPortal } from '../load';

export default async function ManualIndex({ params }: PageProps<'/portal/[slug]/manual'>) {
  const { slug } = await params;
  const ctx = await loadPortal(slug);
  const pages = await pagesForType(ctx.edition.id, ctx.stand.typeId);
  const base = `/portal/${ctx.edition.slug}/manual`;
  const top = pages.filter((p) => !p.parentId);
  return (
    <Stack maw={860}>
      <div>
        <Title order={1} fz={30}>
          Exhibitor manual
        </Title>
        <Text c="dimmed">Rules and information for {ctx.stand.typeName.toLowerCase()} stands at {ctx.edition.name}.</Text>
      </div>
      {top.map((p) => {
        const children = pages.filter((c) => c.parentId === p.id);
        return (
          <Paper key={p.id} withBorder p="md">
            <TextLink href={`${base}/${p.slug}`} fw={700}>
              {p.title}
            </TextLink>
            {children.length ? (
              <Stack gap={2} mt={6} pl="md">
                {children.map((c) => (
                  <TextLink key={c.id} href={`${base}/${c.slug}`} fz="sm">
                    {c.title}
                  </TextLink>
                ))}
              </Stack>
            ) : null}
          </Paper>
        );
      })}
      {!pages.length ? <Text c="dimmed">The manual is being prepared. Please check back soon.</Text> : null}
    </Stack>
  );
}
