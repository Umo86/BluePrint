import { Badge, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { RichHtml } from '@/components/rich-html';
import { TextLink } from '@/components/links';
import { announcementsForType } from '@/server/services/announcements';
import { dateLong } from '@/lib/format';
import { loadPortal } from '../load';

export default async function PortalAnnouncements({ params }: PageProps<'/portal/[slug]/announcements'>) {
  const { slug } = await params;
  const ctx = await loadPortal(slug);
  const news = await announcementsForType(ctx.edition.id, ctx.stand.typeId, 100);
  return (
    <Stack>
      <TextLink href={`/portal/${ctx.edition.slug}`} fz="sm">
        ← Home
      </TextLink>
      <PageHeader title="Announcements" description={`News from the ${ctx.edition.name} team.`} />
      {news.map((a) => (
        <Paper key={a.id} withBorder p="md">
          <Group gap="xs" mb={4}>
            <Title order={2} fz="md">
              {a.title}
            </Title>
            {a.pinned ? (
              <Badge size="xs" color="yellow">
                Pinned
              </Badge>
            ) : null}
          </Group>
          <Text fz="xs" c="dimmed" mb="xs">
            {dateLong(a.publishedAt)}
          </Text>
          <RichHtml html={a.bodyHtml} />
        </Paper>
      ))}
      {news.length === 0 ? (
        <Text c="dimmed" fz="sm">
          No announcements yet.
        </Text>
      ) : null}
    </Stack>
  );
}
