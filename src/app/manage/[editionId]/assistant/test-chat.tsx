'use client';

import { useState } from 'react';
import { Alert, Loader, Paper, Select, Stack, Text } from '@mantine/core';
import { useAction } from '@/lib/use-action';
import { AssistantChat } from '@/components/assistant-chat';
import type { ChatView } from '@/app/portal/help-actions';
import { testChatViewAction } from '../../assistant-actions';

export type TestPerson = { standId: string; userId: string; label: string };

/** The show team tries the assistant as one of its exhibitors, before exhibitors use it. */
export function TestChat({ editionId, people }: { editionId: string; people: TestPerson[] }) {
  const [choice, setChoice] = useState<string | null>(null);
  const [view, setView] = useState<ChatView | null>(null);
  const load = useAction(testChatViewAction, { onSuccess: (v) => setView(v ?? null) });
  const person = people.find((p) => `${p.standId}:${p.userId}` === choice) ?? null;

  if (!people.length) return <Alert color="gray">No exhibitor has joined this show yet, so there is nobody to try the assistant as.</Alert>;
  return (
    <Stack maw={860}>
      <Text fz="sm" c="dimmed">
        Choose an exhibitor and ask what they might ask. The assistant answers as it would for them, from their checklist, forms and orders, so you can check its answers and your house rules before
        exhibitors use it. Test chats use real Claude credit, count towards today’s limit, and are never shown to the exhibitor or sent to the help desk.
      </Text>
      <Select
        label="Chat as"
        placeholder="Choose an exhibitor"
        data={people.map((p) => ({ value: `${p.standId}:${p.userId}`, label: p.label }))}
        value={choice}
        onChange={(v) => {
          setChoice(v);
          setView(null);
          const p = people.find((x) => `${x.standId}:${x.userId}` === v);
          if (p) void load.run(editionId, p.standId, p.userId);
        }}
        searchable
        nothingFoundMessage="No exhibitor found"
        maw={520}
      />
      {person ? (
        <Paper withBorder p="md">
          {!view || load.pending ? (
            <Stack align="center" py="xl">
              <Loader size="sm" />
            </Stack>
          ) : view.available ? (
            <AssistantChat key={`${person.standId}:${person.userId}:${view.conversationId ?? 'new'}`} mode={{ kind: 'test', editionId, standId: person.standId, userId: person.userId }} initial={view} />
          ) : (
            <Alert color="gray">{view.reason ?? 'The assistant is not available.'}</Alert>
          )}
        </Paper>
      ) : null}
    </Stack>
  );
}
