import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AuthCard } from '@/components/auth-card';
import { getCurrentAuth, safeNextPath } from '@/server/auth/current';
import { SignInForm } from './sign-in-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage({ searchParams }: PageProps<'/sign-in'>) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === 'string' ? params.next : null, '/');
  const auth = await getCurrentAuth();
  if (auth && !auth.needsSecondFactor && !auth.needsTwoFactorSetup) redirect(next);
  return (
    <AuthCard title="Sign in to BluePrint" subtitle="We will email you a six-digit code. No password needed.">
      <SignInForm next={next} signedOut={params.signedOut === '1'} />
    </AuthCard>
  );
}
