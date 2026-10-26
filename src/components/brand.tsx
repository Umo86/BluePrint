import { Group, Text } from '@mantine/core';

/**
 * The BluePrint mark: a sheet of drafting blue with a hall drawn on it (walls with a doorway and one
 * stand), beside the name. `tone="white"` is for dark or coloured backgrounds.
 */
export function BrandMark({ size = 'lg', tone = 'ink' }: { size?: 'sm' | 'md' | 'lg'; tone?: 'ink' | 'white' }) {
  const px = size === 'lg' ? 28 : size === 'md' ? 22 : 18;
  return (
    <Group gap={8} wrap="nowrap">
      <svg width={px} height={px} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
        <rect x="1" y="1" width="22" height="22" rx="5" fill="#2b50e0" />
        <path d="M10.5 18H6V6h12v12h-4.5" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinejoin="miter" />
        <rect x="8.4" y="8.4" width="4.4" height="4.4" fill="#fff" />
      </svg>
      <Text
        component="span"
        fw={600}
        fz={Math.round(px * 0.72)}
        c={tone === 'white' ? 'white' : 'var(--bp-ink)'}
        style={{ letterSpacing: '-0.02em', lineHeight: 1 }}
      >
        BluePrint
      </Text>
    </Group>
  );
}
