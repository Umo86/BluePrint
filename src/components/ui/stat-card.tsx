import { Paper, Text } from '@mantine/core';

export function StatCard({ label, value, hint, color }: { label: string; value: React.ReactNode; hint?: React.ReactNode; color?: string }) {
  return (
    <Paper withBorder p="md" radius="md">
      <Text fz="xs" c="dimmed" fw={600} tt="uppercase">
        {label}
      </Text>
      <Text fz={28} fw={700} mt={4} c={color}>
        {value}
      </Text>
      {hint ? (
        <Text fz="xs" c="dimmed" mt={2}>
          {hint}
        </Text>
      ) : null}
    </Paper>
  );
}
