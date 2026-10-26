import { Text } from '@mantine/core';
import { AuthCard } from '@/components/auth-card';
import { ButtonLink } from '@/components/links';

export default function NotFound() {
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
