import { Anchor, Paper, Stack, Text, Title } from '@mantine/core';
import type { EditionContact } from '@/server/db/schema';

/**
 * Who to contact about the show (set by the show team under Show settings → Contacts).
 * Phone and email links are a full 24px tall so they are easy to tap (WCAG 2.2 target size).
 */
export function ShowContacts({ contacts, title = 'Contacts' }: { contacts: EditionContact[]; title?: string }) {
  if (!contacts.length) return null;
  return (
    <Paper withBorder p="md">
      <Title order={2} fz="md" mb="sm">
        {title}
      </Title>
      <Stack gap="sm">
        {contacts.map((c) => (
          <div key={c.id}>
            <Text fz="sm" fw={600}>
              {c.team}
            </Text>
            {c.name ? <Text fz="sm">{c.name}</Text> : null}
            {c.phone ? (
              <Anchor href={`tel:${c.phone.replace(/[^0-9+]/g, '')}`} fz="sm" lh="24px" display="block">
                {c.phone}
              </Anchor>
            ) : null}
            {c.email ? (
              <Anchor href={`mailto:${c.email}`} fz="sm" lh="24px" display="block" style={{ overflowWrap: 'anywhere' }}>
                {c.email}
              </Anchor>
            ) : null}
            {c.note ? (
              <Text fz="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap' }}>
                {c.note}
              </Text>
            ) : null}
          </div>
        ))}
      </Stack>
    </Paper>
  );
}
