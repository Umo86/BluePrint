import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AuthCard } from '@/components/auth-card';
import { getCurrentAuth, safeNextPath } from '@/server/auth/current';
import { TwoFactorForm } from './two-factor-form';

export const metadata: Metadata = { title: 'Two-factor check' };

export default async function TwoFactorPage({ searchParams }: PageProps<'/two-factor'>) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === 'string' ? params.next : null);
  const auth = await getCurrentAuth();
  if (!auth) redirect('/sign-in');
  if (auth.needsTwoFactorSetup) redirect('/two-factor-setup');
  if (!auth.needsSecondFactor) redirect(next);
  return (
    <AuthCard title="Two-factor check" subtitle="Staff accounts need a code from your authenticator app.">
      <TwoFactorForm next={next} />
    </AuthCard>
  );
}
