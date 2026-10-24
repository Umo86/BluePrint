import { Paper, Text } from '@mantine/core';

export function StatCard({ label, value, hint, color }: { label: string; value: React.ReactNode; hint?: React.ReactNode; color?: string }) {
  return (
    <Paper withBorder p="md" radius="md">
      <Text fz="xs" c="dimmed" fw={600} tt="uppercase">
        {label}
      </Text>
      {/* A div, so the value can hold badges or other blocks as well as text. */}
      <Text component="div" fz={28} fw={700} mt={4} c={color}>
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
