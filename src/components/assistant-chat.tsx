'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Badge, Box, Button, Group, Loader, Paper, ScrollArea, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { IconCheck, IconMessagePlus, IconRobot, IconSend, IconUser } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import { ChatText } from './chat-text';
import { applyProposalAction, askAssistantAction, newConversationAction, sendTicketProposalAction, type ChatMessage, type ChatView } from '@/app/portal/help-actions';
import { testChatAskAction, testChatResetAction } from '@/app/manage/assistant-actions';

type Ready = Extract<ChatView, { available: true }>;

/** Who the chat is for: an exhibitor in the portal, or a show team member trying it out as one. */
export type ChatMode = { kind: 'exhibitor'; slug: string; standId: string } | { kind: 'test'; editionId: string; standId: string; userId: string };

function Bubble({ message, children }: { message: Pick<ChatMessage, 'role'>; children: React.ReactNode }) {
  const mine = message.role === 'user';
  return (
    <Group justify={mine ? 'flex-end' : 'flex-start'} align="flex-start" gap={8} wrap="nowrap">
      {!mine ? (
        <Box mt={4} c="blue" aria-hidden>
          <IconRobot size={20} />
        </Box>
      ) : null}
      <Paper
        p="sm"
        radius="md"
        maw="85%"
        bg={mine ? 'var(--mantine-color-blue-light)' : 'var(--mantine-color-gray-0)'}
        withBorder={!mine}
        aria-label={mine ? 'You said' : 'The assistant said'}
      >
        {children}
      </Paper>
      {mine ? (
        <Box mt={4} c="dimmed" aria-hidden>
          <IconUser size={20} />
        </Box>
      ) : null}
    </Group>
  );
}

/** A question the assistant prepared for the show team, with a phone number and a good time to call. */
function TicketCard({
  ticket,
  handoff,
  test,
  readOnly,
  pending,
  phoneError,
  onSend,
}: {
  ticket: NonNullable<ChatMessage['meta']['ticket']>;
  handoff: Ready['handoff'];
  test: boolean;
  readOnly: boolean;
  pending: boolean;
  phoneError?: string;
  onSend: (contact: { phone: string; bestTime: string }) => Promise<string | null>;
}) {
  const [phone, setPhone] = useState(handoff.phone);
  const [bestTime, setBestTime] = useState('');
  const [expectation, setExpectation] = useState(handoff.expectation);
  return (
    <Paper withBorder p="xs" mt={6} bg="var(--mantine-color-body)">
      <Text fz="xs" fw={700}>
        For the show team: {ticket.subject}
      </Text>
      <Text fz="xs" style={{ whiteSpace: 'pre-wrap' }}>
        {ticket.message}
      </Text>
      {ticket.sent ? (
        <>
          <Badge mt={6} color="green" variant="light" leftSection={<IconCheck size={12} />}>
            Sent ({ticket.sent})
          </Badge>
          <Text fz="xs" c="dimmed" mt={4}>
            {expectation}
          </Text>
        </>
      ) : (
        <Stack gap={6} mt={6}>
          {handoff.askPhone ? (
            <Group gap="xs" grow align="flex-start">
              <TextInput
                size="xs"
                label="Your phone number (optional)"
                description="If a call would be quicker."
                value={phone}
                onChange={(e) => setPhone(e.currentTarget.value)}
                maxLength={40}
                error={phoneError}
                disabled={readOnly || test}
                autoComplete="tel"
              />
              <TextInput
                size="xs"
                label="Best time to call (optional)"
                placeholder="For example, weekday mornings"
                value={bestTime}
                onChange={(e) => setBestTime(e.currentTarget.value)}
                maxLength={80}
                disabled={readOnly || test}
              />
            </Group>
          ) : null}
          <Text fz="xs" c="dimmed">
            {handoff.expectation}
          </Text>
          {test ? (
            <Text fz="xs" c="dimmed">
              Test chat: in a real chat the exhibitor sends this to your help desk.
            </Text>
          ) : (
            <Button
              size="compact-xs"
              style={{ alignSelf: 'flex-start' }}
              disabled={readOnly}
              loading={pending}
              onClick={async () => {
                const r = await onSend({ phone, bestTime });
                if (r) setExpectation(r);
              }}
            >
              Send to the show team
            </Button>
          )}
        </Stack>
      )}
    </Paper>
  );
}

export function AssistantChat({ mode, initial, compact = false }: { mode: ChatMode; initial: Ready; compact?: boolean }) {
  const router = useRouter();
  const test = mode.kind === 'test';
  const [messages, setMessages] = useState<ChatMessage[]>(initial.messages);
  const [draft, setDraft] = useState('');
  const [pendingText, setPendingText] = useState<string | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const onAnswer = (data?: { messages: ChatMessage[] }) => {
    if (data) setMessages((m) => [...m, ...data.messages]);
    setPendingText(null);
  };
  const ask = useAction(askAssistantAction, { onSuccess: onAnswer });
  const askTest = useAction(testChatAskAction, { onSuccess: onAnswer });
  const apply = useAction(applyProposalAction);
  const sendTicket = useAction(sendTicketProposalAction);
  const fresh = useAction(newConversationAction, { onSuccess: () => setMessages([]) });
  const freshTest = useAction(testChatResetAction, { onSuccess: () => setMessages([]) });
  const asking = ask.pending || askTest.pending;
  const readOnly = initial.readOnly;

  useEffect(() => {
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, pendingText]);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || asking) return;
    setPendingText(t);
    setDraft('');
    const r = mode.kind === 'test' ? await askTest.run(mode.editionId, mode.standId, mode.userId, t) : await ask.run(mode.standId, t);
    if (!r.ok) {
      setPendingText(null);
      setDraft(t);
    }
  };

  const updateMeta = (id: string, change: (m: ChatMessage) => ChatMessage) => setMessages((all) => all.map((m) => (m.id === id ? change(m) : m)));

  return (
    <Stack gap="sm" h="100%">
      {initial.offline ? (
        <Alert color="gray" p="xs">
          <Text fz="xs">Practice mode: Claude is not connected here, so answers are simple searches of the manual.</Text>
        </Alert>
      ) : null}
      <ScrollArea viewportRef={viewport} h={compact ? 'calc(100dvh - 330px)' : 520} type="auto" offsetScrollbars>
        <Stack gap="sm" pr={4} aria-live="polite">
          <Bubble message={{ role: 'assistant' }}>
            <ChatText text={initial.greeting.text} />
          </Bubble>
          {messages.map((m) => (
            <Bubble key={m.id} message={m}>
              {m.role === 'user' ? (
                <Text fz="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {m.content}
                </Text>
              ) : (
                <>
                  <ChatText text={m.content} />
                  {(m.meta.proposals ?? []).map((p, i) => (
                    <Paper key={i} withBorder p="xs" mt={6} bg="var(--mantine-color-body)">
                      <Text fz="xs" fw={700} mb={4}>
                        Suggested answers for “{p.taskTitle}”
                      </Text>
                      {p.display.map((d) => (
                        <Text key={d.label} fz="xs">
                          <Text span fz="xs" c="dimmed">
                            {d.label}:
                          </Text>{' '}
                          {d.value}
                        </Text>
                      ))}
                      {mode.kind === 'test' ? (
                        <Text fz="xs" c="dimmed" mt={6}>
                          Test chat: in a real chat the exhibitor puts these answers in their form with a button.
                        </Text>
                      ) : p.applied ? (
                        <Group gap={6} mt={6}>
                          <Badge color="green" variant="light" leftSection={<IconCheck size={12} />}>
                            In the form
                          </Badge>
                          <Button size="compact-xs" variant="subtle" onClick={() => router.push(`/portal/${mode.slug}/tasks/${p.taskId}`)}>
                            Open the form to check and send it
                          </Button>
                        </Group>
                      ) : (
                        <Button
                          size="compact-xs"
                          mt={6}
                          disabled={readOnly}
                          loading={apply.pending}
                          onClick={async () => {
                            const r = await apply.run(mode.slug, mode.standId, m.id, i);
                            if (r.ok) updateMeta(m.id, (x) => ({ ...x, meta: { ...x.meta, proposals: (x.meta.proposals ?? []).map((q, j) => (j === i ? { ...q, applied: true } : q)) } }));
                          }}
                        >
                          Put these answers in the form
                        </Button>
                      )}
                    </Paper>
                  ))}
                  {m.meta.ticket ? (
                    <TicketCard
                      ticket={m.meta.ticket}
                      handoff={initial.handoff}
                      test={test}
                      readOnly={readOnly}
                      pending={sendTicket.pending}
                      phoneError={sendTicket.fieldErrors.phone}
                      onSend={async (contact) => {
                        if (mode.kind !== 'exhibitor') return null;
                        const r = await sendTicket.run(mode.slug, mode.standId, m.id, contact);
                        if (!r.ok || !r.data) return null;
                        const sent = r.data.number ?? 'sent';
                        updateMeta(m.id, (x) => ({ ...x, meta: { ...x.meta, ticket: x.meta.ticket ? { ...x.meta.ticket, sent } : null } }));
                        return r.data.expectation;
                      }}
                    />
                  ) : null}
                </>
              )}
            </Bubble>
          ))}
          {pendingText ? (
            <>
              <Bubble message={{ role: 'user' }}>
                <Text fz="sm" style={{ whiteSpace: 'pre-wrap' }}>
                  {pendingText}
                </Text>
              </Bubble>
              <Group gap={6} pl={28}>
                <Loader size="xs" type="dots" />
                <Text fz="xs" c="dimmed">
                  Looking that up…
                </Text>
              </Group>
            </>
          ) : null}
        </Stack>
      </ScrollArea>
      {messages.length === 0 && !pendingText ? (
        <Group gap={6}>
          {initial.greeting.suggestions.map((s) => (
            <Button key={s} size="compact-xs" variant="light" radius="xl" onClick={() => send(s)} disabled={readOnly}>
              {s}
            </Button>
          ))}
        </Group>
      ) : null}
      {readOnly ? (
        <Alert color="gray" p="xs">
          <Text fz="xs">You are viewing as someone else, so the assistant is switched off.</Text>
        </Alert>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
        >
          <Group align="flex-end" gap="xs" wrap="nowrap">
            <Textarea
              aria-label="Your question"
              placeholder="Ask about the show, your checklist or what to order…"
              value={draft}
              onChange={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
              autosize
              minRows={1}
              maxRows={5}
              maxLength={2000}
              style={{ flex: 1 }}
            />
            <Button type="submit" loading={asking} disabled={!draft.trim()} leftSection={<IconSend size={16} />}>
              Send
            </Button>
          </Group>
        </form>
      )}
      <Group justify="space-between" gap="xs">
        <Text fz="xs" c="dimmed" maw={420}>
          {test
            ? 'Test chat: answers come from Claude and count towards today’s limit. Nothing is saved for the exhibitor, and nothing goes to the help desk.'
            : 'Answers come from the exhibitor manual and can be wrong, so check anything important. The show team can read these conversations.'}
        </Text>
        {messages.length ? (
          <Button
            size="compact-xs"
            variant="subtle"
            leftSection={<IconMessagePlus size={14} />}
            loading={fresh.pending || freshTest.pending}
            onClick={() => (mode.kind === 'test' ? freshTest.run(mode.editionId, mode.standId) : fresh.run(mode.standId))}
            disabled={readOnly}
          >
            {test ? 'Start again' : 'New conversation'}
          </Button>
        ) : null}
      </Group>
    </Stack>
  );
}
