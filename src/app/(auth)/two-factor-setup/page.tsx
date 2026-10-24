import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AuthCard } from '@/components/auth-card';
import { getCurrentAuth } from '@/server/auth/current';
import { EnrollForm } from './enroll-form';

export const metadata: Metadata = { title: 'Set up two-factor sign-in' };

export default async function TwoFactorSetupPage() {
  const auth = await getCurrentAuth();
  if (!auth) redirect('/sign-in');
  if (auth.user.totpEnabledAt) redirect('/');
  return (
    <AuthCard
      title="Set up two-factor sign-in"
      subtitle="Because you can see exhibitor and payment information, your account needs a second step at sign-in."
    >
      <EnrollForm />
    </AuthCard>
  );
}
