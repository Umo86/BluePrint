import { Group, Stack, Text, Title } from '@mantine/core';

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: string }) {
  return (
    <Group justify="space-between" align="flex-start" mb="lg" wrap="wrap" gap="md">
      <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
        {eyebrow ? (
          <Text fz="xs" fw={700} c="dimmed" tt="uppercase">
            {eyebrow}
          </Text>
        ) : null}
        <Title order={1} fz={26} lh={1.2}>
          {title}
        </Title>
        {description ? (
          <Text c="dimmed" fz="sm" maw={760}>
            {description}
          </Text>
        ) : null}
      </Stack>
      {actions ? <Group gap="xs">{actions}</Group> : null}
    </Group>
  );
}
