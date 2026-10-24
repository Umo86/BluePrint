import {
  IconAddressBook,
  IconBooks,
  IconBuildingStore,
  IconCalendarEvent,
  IconClipboardList,
  IconLayoutDashboard,
  IconServer,
  IconSettings,
  IconShieldLock,
  IconUsers,
} from '@tabler/icons-react';
import { AppShell } from '@/components/app-shell';
import { PlatformNotice } from '@/components/platform-notice';
import { getCurrentAuth, requireSuperAdmin } from '@/server/auth/current';
import { getWorkspaces } from '@/server/services/workspaces';

export default async function AdminLayout({ children }: LayoutProps<'/admin'>) {
  const actor = await requireSuperAdmin();
  const auth = (await getCurrentAuth())!;
  const workspaces = await getWorkspaces(actor);
  const nav = [
    { label: 'Overview', href: '/admin', exact: true, icon: <IconLayoutDashboard size={18} /> },
    { label: 'Shows and editions', href: '/admin/shows', icon: <IconCalendarEvent size={18} />, section: 'Manage' },
    { label: 'Users', href: '/admin/users', icon: <IconUsers size={18} />, section: 'Manage' },
    { label: 'Companies', href: '/admin/companies', icon: <IconAddressBook size={18} />, section: 'Manage' },
    { label: 'Suppliers', href: '/admin/suppliers', icon: <IconBuildingStore size={18} />, section: 'Manage' },
    { label: 'Library', href: '/admin/library', icon: <IconBooks size={18} />, section: 'Manage' },
    { label: 'Platform settings', href: '/admin/settings', icon: <IconSettings size={18} />, section: 'Platform' },
    { label: 'Audit log', href: '/admin/audit', icon: <IconClipboardList size={18} />, section: 'Platform' },
    { label: 'System', href: '/admin/system', icon: <IconServer size={18} />, section: 'Platform' },
    { label: 'Privacy (GDPR)', href: '/admin/gdpr', icon: <IconShieldLock size={18} />, section: 'Platform' },
  ];
  return (
    <AppShell title="Super admin" subtitle="Full control of BluePrint" nav={nav} user={{ name: auth.user.name, email: auth.user.email }} workspaces={workspaces}>
      <PlatformNotice />
      {children}
    </AppShell>
  );
}
