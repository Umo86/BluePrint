import { Stack, Text } from '@mantine/core';
import { AuthCard } from '@/components/auth-card';
import { describeUnsubscribe } from '@/server/services/campaigns';
import { UnsubscribeButton } from './unsubscribe-button';

/** Unsubscribe from a show's update emails. Works without signing in; nothing changes until the button is pressed. */
export default async function Unsubscribe({ params }: PageProps<'/unsubscribe/[token]'>) {
  const { token } = await params;
  const who = await describeUnsubscribe(token);
  if (!who) {
    return (
      <AuthCard title="Link not recognised">
        <Text fz="sm">This unsubscribe link is not valid. Copy the whole link from the email and try again.</Text>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Unsubscribe from show updates" subtitle={who.show}>
      <Stack>
        <Text fz="sm">
          Stop emailing <strong>{who.email}</strong> with general updates about {who.show}? Emails about your own deadlines, orders and approvals will still arrive.
        </Text>
        <UnsubscribeButton token={token} />
      </Stack>
    </AuthCard>
  );
}
