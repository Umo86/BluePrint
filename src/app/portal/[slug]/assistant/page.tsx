import { Alert, Paper, Stack, Text } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { TextLink } from '@/components/links';
import { AssistantChat } from '@/components/assistant-chat';
import { assistantView } from '@/server/assistant';
import { loadPortal } from '../load';

export default async function PortalAssistant({ params }: PageProps<'/portal/[slug]/assistant'>) {
  const { slug } = await params;
  const ctx = await loadPortal(slug);
  const view = await assistantView(ctx.actor, ctx.stand.id);
  return (
    <Stack>
      <PageHeader title="Your exhibitor assistant" description="Ask about the show, your checklist or what to order. It answers from the exhibitor manual and can fill in forms for you to check." />
      {view.available ? (
        <Paper withBorder p="md" maw={820}>
          <AssistantChat
            slug={ctx.edition.slug}
            standId={ctx.stand.id}
            initial={{ ...view, messages: view.messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })) }}
          />
        </Paper>
      ) : (
        <Alert color="gray" maw={820}>
          <Text fz="sm">{view.reason ?? 'The assistant is not available.'}</Text>
          <TextLink href={`/portal/${ctx.edition.slug}/help`} fz="sm">
            Ask the show team instead
          </TextLink>
        </Alert>
      )}
    </Stack>
  );
}
