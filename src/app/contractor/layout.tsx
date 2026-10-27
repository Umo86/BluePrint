import { IconCrane } from '@tabler/icons-react';
import { AppShell } from '@/components/app-shell';
import { PlatformNotice } from '@/components/platform-notice';
import { getCurrentAuth, requireActor } from '@/server/auth/current';
import { getWorkspaces } from '@/server/services/workspaces';

/** The contractor area. Someone with no stands (for example after an exhibitor changed contractor) sees an empty list. */
export default async function ContractorLayout({ children }: LayoutProps<'/contractor'>) {
  const actor = await requireActor();
  const auth = (await getCurrentAuth())!;
  const workspaces = await getWorkspaces(actor);
  return (
    <AppShell
      title="Stand contractor"
      subtitle="Space-only stand packs"
      nav={[{ label: 'Your stands', href: '/contractor', icon: <IconCrane size={18} /> }]}
      user={{ name: auth.user.name, email: auth.user.email }}
      workspaces={workspaces}
      viewAs={auth.viewAsUser ? { name: auth.viewAsUser.name, email: auth.viewAsUser.email } : null}
    >
      <PlatformNotice />
      {children}
    </AppShell>
  );
}
