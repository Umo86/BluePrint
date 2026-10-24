import { redirect } from 'next/navigation';
import { Alert, Button, Stack } from '@mantine/core';
import { LinkCard } from '@/components/link-card';
import { AuthCard } from '@/components/auth-card';
import { requireActor } from '@/server/auth/current';
import { getWorkspaces } from '@/server/services/workspaces';
import { signOutAction } from './(auth)/actions';

export default async function Home() {
  const actor = await requireActor();
  const workspaces = await getWorkspaces(actor);
  if (workspaces.length === 1) redirect(workspaces[0].href);
  return (
    <AuthCard title={workspaces.length ? 'Where would you like to go?' : 'Nothing to show yet'}>
      {workspaces.length ? (
        <Stack gap="xs">
          {workspaces.map((w) => (
            <LinkCard key={w.href} href={w.href} title={w.label} description={w.description} />
          ))}
        </Stack>
      ) : (
        <Alert color="blue">Your account is not linked to a show yet. When the show team invites you, it will appear here.</Alert>
      )}
      <form action={signOutAction}>
        <Button type="submit" variant="subtle" fullWidth>
          Sign out
        </Button>
      </form>
    </AuthCard>
  );
}
