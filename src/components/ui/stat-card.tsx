import { Paper, Text } from '@mantine/core';

export function StatCard({ label, value, hint, color }: { label: string; value: React.ReactNode; hint?: React.ReactNode; color?: string }) {
  return (
    <Paper withBorder p="md" radius="md">
      <Text fz="sm" c="dimmed" fw={500}>
        {label}
      </Text>
      {/* A div, so the value can hold badges or other blocks as well as text. */}
      <Text component="div" className="bp-figure" fz={32} mt={6} c={color}>
        {value}
      </Text>
      {hint ? (
        <Text component="div" fz="xs" c="dimmed" mt={2}>
          {hint}
        </Text>
      ) : null}
    </Paper>
  );
}
