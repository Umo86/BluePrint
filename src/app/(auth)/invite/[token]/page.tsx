import type { Metadata } from 'next';
import { Alert, Anchor, Text } from '@mantine/core';
import { AuthCard } from '@/components/auth-card';
import { findInvitation } from '@/server/auth/invitations';
import { getCurrentAuth } from '@/server/auth/current';
import { AcceptInviteForm } from './accept-form';

export const metadata: Metadata = { title: 'Accept invitation' };

export default async function InvitePage({ params }: PageProps<'/invite/[token]'>) {
  const { token } = await params;
  const auth = await getCurrentAuth();
  const signedIn = auth && !auth.needsTwoFactorSetup && !auth.needsSecondFactor && !auth.viewAsUser ? auth.user.email : null;
  const found = await findInvitation(token, { signedInEmail: signedIn });
  if (!found) {
    return (
      <AuthCard title="This invitation no longer works">
        <Alert color="orange">It may have expired, been replaced by a newer invitation, or already been used.</Alert>
        <Text fz="sm">
          If you already have an account, <Anchor href="/sign-in">sign in</Anchor>. Otherwise ask the person who invited you to send a new invitation.
        </Text>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={found.headline} subtitle={`Invitation for ${found.invitation.email}`}>
      <AcceptInviteForm
        token={token}
        needsEmailCode={found.needsEmailCode}
        existingName={found.existingUser?.name ?? ''}
        kind={found.invitation.kind}
      />
    </AuthCard>
  );
}
