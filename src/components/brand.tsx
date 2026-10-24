import { Group, Text } from '@mantine/core';

export function BrandMark({ size = 'lg' }: { size?: 'sm' | 'md' | 'lg' }) {
  const fz = size === 'lg' ? 26 : size === 'md' ? 20 : 16;
  return (
    <Group gap={6} wrap="nowrap" aria-label="BluePrint">
      <svg width={fz} height={fz} viewBox="0 0 24 24" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="5" fill="var(--mantine-color-blueprint-7)" />
        <path d="M7 7h10M7 12h10M7 17h6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <Text fw={700} fz={fz * 0.8} c="var(--mantine-color-blueprint-8)" style={{ letterSpacing: '-0.01em' }}>
        Blue<span style={{ color: 'var(--mantine-color-pink-7)' }}>P</span>rint
      </Text>
    </Group>
  );
}
