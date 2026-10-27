import { Button, Text } from '@mantine/core';
import { AuthCard } from '@/components/auth-card';
import { ButtonLink } from '@/components/links';
import { getCurrentAuth } from '@/server/auth/current';
import { stopViewAsAction } from './view-as-actions';

export default async function NotFound() {
  // While viewing BluePrint as someone else, pages of your own (such as the super admin dashboard)
  // are out of reach: offer the way back instead of a dead end.
  const auth = await getCurrentAuth().catch(() => null);
  if (auth?.viewAsUser) {
    const who = auth.viewAsUser.name || auth.viewAsUser.email;
    return (
      <AuthCard title={`You’re viewing BluePrint as ${who}`}>
        <Text c="dimmed" fz="sm">
          This page is not part of what {who} can see. Stop viewing to go back to your own account.
        </Text>
        <form action={stopViewAsAction}>
          <Button type="submit" size="md" fullWidth className="bp-notch">
            Stop viewing
          </Button>
        </form>
        <ButtonLink href="/start" size="md" variant="default">
          Keep viewing as {who}
        </ButtonLink>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="We couldn’t find that page">
      <Text c="dimmed" fz="sm">
        The link may be out of date, or you may not have access to it. If someone sent you here, ask them to check the link.
      </Text>
      <ButtonLink href="/start" size="md" className="bp-notch">
        Go to my BluePrint
      </ButtonLink>
    </AuthCard>
  );
}
