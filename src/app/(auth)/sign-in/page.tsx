import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AuthCard } from '@/components/auth-card';
import { getCurrentAuth, safeNextPath } from '@/server/auth/current';
import { emailMode, env } from '@/server/env';
import { SignInForm } from './sign-in-form';

export const metadata: Metadata = { title: 'Sign in' };

/** The test login to show while the site is being tried out (both settings must be set). */
function testLogin() {
  const e = env();
  return e.TEST_LOGIN_EMAIL && e.TEST_LOGIN_PASSWORD ? { email: e.TEST_LOGIN_EMAIL, password: e.TEST_LOGIN_PASSWORD } : null;
}

export default async function SignInPage({ searchParams }: PageProps<'/sign-in'>) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === 'string' ? params.next : null);
  const auth = await getCurrentAuth();
  if (auth && !auth.needsSecondFactor && !auth.needsTwoFactorSetup) redirect(next);
  return (
    <AuthCard title="Sign in to BluePrint">
      {/* Emailed codes are offered only when email can actually be sent. */}
      <SignInForm next={next} signedOut={params.signedOut === '1'} testLogin={testLogin()} codes={emailMode() !== 'off'} />
    </AuthCard>
  );
}
