import { Paper, Stack, Text } from '@mantine/core';
import { notFound, redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth-card';
import { TextLink } from '@/components/links';
import { requireActor } from '@/server/auth/current';
import { mySuppliers } from '@/server/services/catalogue';

export default async function SupplierHome() {
  const actor = await requireActor();
  const list = await mySuppliers(actor);
  if (!list.length) notFound();
  if (list.length === 1) redirect(`/supplier/${list[0].id}`);
  return (
    <AuthCard title="Choose a supplier" subtitle="You work for more than one supplier on BluePrint.">
      <Stack gap="xs">
        {list.map((s) => (
          <Paper key={s.id} withBorder p="sm">
            <TextLink href={`/supplier/${s.id}`} fw={600}>
              {s.name}
            </TextLink>
            <Text fz="xs" c="dimmed">
              {s.email}
            </Text>
          </Paper>
        ))}
      </Stack>
    </AuthCard>
  );
}
