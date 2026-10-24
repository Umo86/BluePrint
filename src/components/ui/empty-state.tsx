import { Paper, Stack, Text } from '@mantine/core';

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <Paper withBorder p="xl" radius="md" bg="var(--mantine-color-white)">
      <Stack align="center" gap="xs">
        <Text fw={600}>{title}</Text>
        {description ? (
          <Text c="dimmed" fz="sm" ta="center" maw={480}>
            {description}
          </Text>
        ) : null}
        {action}
      </Stack>
    </Paper>
  );
}
