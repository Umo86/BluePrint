'use client';

import { useEffect } from 'react';
import { Button, Center, Code, Container, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { BrandMark } from '@/components/brand';

/** Shown when a page fails unexpectedly. Server error details never reach the browser; the reference matches the server log. */
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error && 'digest' in error ? String((error as Error & { digest?: string }).digest ?? '') : '';
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Center mih="70vh" py="xl" bg="var(--bp-mist)">
      <Container size={480} w="100%">
        <Stack gap="lg" align="center">
          <BrandMark />
          <Paper withBorder p="xl" radius="lg" w="100%" shadow="xl">
            <Stack gap="sm">
              <Title order={1} fz={30}>
                Something went wrong
              </Title>
              <Text c="dimmed" fz="sm">
                Sorry, that didn’t work. Please try again. If it keeps happening, contact the show team and quote the reference below.
              </Text>
              {digest ? (
                <Text fz="xs" c="dimmed">
                  Reference: <Code>{digest}</Code>
                </Text>
              ) : null}
              <Group>
                <Button className="bp-notch" onClick={() => retry()}>
                  Try again
                </Button>
                <Button component="a" href="/start" variant="default">
                  Go to my BluePrint
                </Button>
              </Group>
            </Stack>
          </Paper>
        </Stack>
      </Container>
    </Center>
  );
}
