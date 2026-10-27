'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Affix, Alert, Button, Drawer, Loader, Stack, Text } from '@mantine/core';
import { IconMessageChatbot } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import { TextLink } from './links';
import { AssistantChat } from './assistant-chat';
import { assistantViewAction, type ChatView } from '@/app/portal/help-actions';

/**
 * The "Ask the assistant" button in the corner of every portal page, opening the chat in a side panel.
 * `name` is the show's own name for it, if it has one.
 */
export function AssistantLauncher({ slug, standId, name = null }: { slug: string; standId: string; name?: string | null }) {
  const pathname = usePathname();
  const [opened, setOpened] = useState(false);
  const [view, setView] = useState<ChatView | null>(null);
  const load = useAction(assistantViewAction, { onSuccess: (v) => setView(v ?? null), notifyErrors: true });
  const open = () => {
    setOpened(true);
    if (!view) void load.run(standId);
  };
  // The assistant's own page already shows the chat.
  if (pathname.endsWith('/assistant')) return null;
  return (
    <>
      {/* Room at the end of the page so the button never covers the last thing on it. */}
      <div style={{ height: 72 }} aria-hidden />
      <Affix position={{ bottom: 20, right: 20 }}>
        <Button size="md" radius="xl" leftSection={<IconMessageChatbot size={20} />} onClick={open} aria-haspopup="dialog" style={{ boxShadow: 'var(--mantine-shadow-md)' }}>
          {name ? `Ask ${name}` : 'Ask the assistant'}
        </Button>
      </Affix>
      <Drawer opened={opened} onClose={() => setOpened(false)} position="right" size="lg" title={name ?? 'Your exhibitor assistant'} closeButtonProps={{ 'aria-label': 'Close the assistant' }}>
        {!view ? (
          <Stack align="center" py="xl">
            <Loader size="sm" />
          </Stack>
        ) : view.available ? (
          <AssistantChat key={view.conversationId ?? 'new'} mode={{ kind: 'exhibitor', slug, standId }} initial={view} compact />
        ) : (
          <Alert color="gray">
            <Text fz="sm">{view.reason ?? 'The assistant is not available.'}</Text>
            <TextLink href={`/portal/${slug}/help`} fz="sm">
              Ask the show team instead
            </TextLink>
          </Alert>
        )}
      </Drawer>
    </>
  );
}
