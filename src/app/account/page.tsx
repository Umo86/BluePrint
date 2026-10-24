import type { Metadata } from 'next';
import { Container, Stack, Title } from '@mantine/core';
import { requireActor, getCurrentAuth } from '@/server/auth/current';
import { getAccount } from '@/server/services/account';
import { listActiveSessions } from '@/server/auth/sessions';
import { getWorkspaces } from '@/server/services/workspaces';
import { AppShell } from '@/components/app-shell';
import { AccountForms } from './account-forms';

export const metadata: Metadata = { title: 'Account and security' };

export default async function AccountPage() {
  const actor = await requireActor();
  const auth = (await getCurrentAuth())!;
  const user = await getAccount(actor);
  const sessions = await listActiveSessions(actor.realUserId);
  const workspaces = await getWorkspaces(actor);
  return (
    <AppShell
      title="Account and security"
      nav={workspaces.map((w) => ({ label: w.label, href: w.href }))}
      user={{ name: auth.user.name, email: auth.user.email }}
      workspaces={workspaces}
      viewAs={auth.viewAsUser ? { name: auth.viewAsUser.name, email: auth.viewAsUser.email } : null}
    >
      <Container size="sm" px={0}>
        <Stack>
          <Title order={1} fz={26}>
            Account and security
          </Title>
          <AccountForms
            profile={{ name: user.name, email: user.email, phone: user.phone ?? '', jobTitle: user.jobTitle ?? '' }}
            hasPassword={Boolean(user.passwordHash)}
            twoFactorEnabled={Boolean(user.totpEnabledAt)}
            isStaff={auth.isStaff}
            recoveryCodesLeft={user.recoveryCodeHashes.length}
            currentSessionId={auth.session.id}
            sessions={sessions.map((s) => ({
              id: s.id,
              createdAt: s.createdAt.toISOString(),
              lastSeenAt: s.lastSeenAt.toISOString(),
              userAgent: s.userAgent ?? '',
              ip: s.ip ?? '',
            }))}
          />
        </Stack>
      </Container>
    </AppShell>
  );
}
