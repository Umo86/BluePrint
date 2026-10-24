'use client';

import Link from 'next/link';
import { Paper, Text } from '@mantine/core';

export function LinkCard({ href, title, description }: { href: string; title: string; description?: string }) {
  return (
    <Paper withBorder p="sm" component={Link} href={href} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <Text fw={600}>{title}</Text>
      {description ? (
        <Text fz="sm" c="dimmed">
          {description}
        </Text>
      ) : null}
    </Paper>
  );
}
