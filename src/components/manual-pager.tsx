'use client';

import Link from 'next/link';
import { Paper, SimpleGrid, Text } from '@mantine/core';

type Neighbour = { slug: string; title: string } | null;

/** "Previous" and "Next" links at the foot of a manual page, so the manual can be read straight through. */
export function ManualPager({ base, previous, next }: { base: string; previous: Neighbour; next: Neighbour }) {
  if (!previous && !next) return null;
  return (
    <SimpleGrid component="nav" aria-label="Manual pages" cols={2} spacing="sm">
      {previous ? (
        <Paper component={Link} href={`${base}/${previous.slug}`} withBorder p="sm" rel="prev" style={{ textDecoration: 'none', color: 'inherit' }}>
          <Text fz="xs" c="dimmed">
            ← Previous
          </Text>
          <Text fz="sm" fw={600} c="var(--mantine-color-anchor)">
            {previous.title}
          </Text>
        </Paper>
      ) : (
        <div />
      )}
      {next ? (
        <Paper component={Link} href={`${base}/${next.slug}`} withBorder p="sm" ta="right" rel="next" style={{ textDecoration: 'none', color: 'inherit' }}>
          <Text fz="xs" c="dimmed">
            Next →
          </Text>
          <Text fz="sm" fw={600} c="var(--mantine-color-anchor)">
            {next.title}
          </Text>
        </Paper>
      ) : null}
    </SimpleGrid>
  );
}
