import { notFound } from 'next/navigation';
import {
  IconAddressBook,
  IconBook2,
  IconBuildingStore,
  IconChecklist,
  IconCrane,
  IconLayoutDashboard,
  IconLayoutGrid,
  IconMail,
  IconMessageChatbot,
  IconLifebuoy,
  IconFileSpreadsheet,
  IconReceipt,
  IconSettings,
  IconSpeakerphone,
  IconUsersGroup,
} from '@tabler/icons-react';
import { AppShell, type NavItem } from '@/components/app-shell';
import { PlatformNotice } from '@/components/platform-notice';
import { DemoFrame } from '@/components/demo-frame';
import { getCurrentAuth, requireActor } from '@/server/auth/current';
import { getEditionForStaff } from '@/server/services/editions';
import { getWorkspaces } from '@/server/services/workspaces';
import { AppError } from '@/server/errors';
import { openTicketCount } from '@/server/services/helpdesk';
import { unansweredCount } from '@/server/assistant';
import { ROLE_LABELS } from '@/lib/roles';

export default async function ManageLayout({ children, params }: LayoutProps<'/manage/[editionId]'>) {
  const { editionId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(editionId)) notFound();
  const actor = await requireActor();
  let loaded: Awaited<ReturnType<typeof getEditionForStaff>>;
  try {
    loaded = await getEditionForStaff(actor, editionId);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
  const { edition, show, access } = loaded;
  const auth = (await getCurrentAuth())!;
  const workspaces = await getWorkspaces(actor);
  const p = access.permissions;
  const isAdmin = access.role === 'super_admin' || access.role === 'show_admin';
  const base = `/manage/${edition.id}`;

  const nav: NavItem[] = [];
  if (p.has('view')) {
    nav.push({ label: 'Overview', href: base, exact: true, icon: <IconLayoutDashboard size={18} /> });
    if (p.has('view_reports') || p.has('manage_exhibitors') || p.has('manage_orders') || p.has('review_space_only')) {
      nav.push({ label: 'Reports', href: `${base}/reports`, icon: <IconFileSpreadsheet size={18} /> });
    }
    nav.push({ label: 'Exhibitors', href: `${base}/exhibitors`, icon: <IconAddressBook size={18} />, section: 'Exhibitors' });
    nav.push({ label: 'Stands', href: `${base}/stands`, icon: <IconLayoutGrid size={18} />, section: 'Exhibitors' });
  }
  // Kept with the other exhibitor pages (health and safety reviewers see only this one).
  if (p.has('review_space_only') || p.has('manage_exhibitors')) {
    nav.push({ label: 'Space-only approvals', href: `${base}/space-only`, icon: <IconCrane size={18} />, section: 'Exhibitors' });
  }
  if (p.has('send_emails')) nav.push({ label: 'Emails', href: `${base}/emails`, icon: <IconMail size={18} />, section: 'Exhibitors' });
  if (p.has('helpdesk')) {
    const waiting = await openTicketCount(edition.id);
    nav.push({ label: 'Help desk', href: `${base}/help-desk`, icon: <IconLifebuoy size={18} />, section: 'Exhibitors', badge: waiting || null });
  }
  if (p.has('view')) {
    nav.push({ label: 'Tasks and forms', href: `${base}/tasks`, icon: <IconChecklist size={18} />, section: 'Exhibitor manual' });
    nav.push({ label: 'Manual pages', href: `${base}/manual`, icon: <IconBook2 size={18} />, section: 'Exhibitor manual' });
    nav.push({ label: 'Announcements', href: `${base}/announcements`, icon: <IconSpeakerphone size={18} />, section: 'Exhibitor manual' });
  }
  if (p.has('helpdesk') || p.has('edit_content')) {
    const gaps = await unansweredCount(edition.id);
    nav.push({ label: 'AI assistant', href: `${base}/assistant`, icon: <IconMessageChatbot size={18} />, section: 'Exhibitor manual', badge: gaps || null });
  }
  if (p.has('manage_orders')) nav.push({ label: 'Shop catalogue', href: `${base}/shop`, icon: <IconBuildingStore size={18} />, section: 'Shop' });
  if (p.has('manage_orders') || p.has('view_reports')) nav.push({ label: 'Orders', href: `${base}/orders`, icon: <IconReceipt size={18} />, section: 'Shop' });
  if (isAdmin || p.has('edit_content') || p.has('manage_exhibitors')) {
    nav.push({ label: 'Show settings', href: `${base}/settings`, icon: <IconSettings size={18} />, section: 'Set-up' });
  }
  if (isAdmin) nav.push({ label: 'Team', href: `${base}/team`, icon: <IconUsersGroup size={18} />, section: 'Set-up' });
  if (access.role === 'super_admin') nav.push({ label: 'Back to super admin', href: `/admin/editions/${edition.id}`, section: 'Super admin' });

  const roleLabel = access.role === 'super_admin' ? 'Super admin' : ROLE_LABELS[access.role];
  return (
    <AppShell
      title={edition.name}
      subtitle={`${show.name} · ${roleLabel}${edition.status === 'draft' ? ' · Draft' : ''}`}
      nav={nav}
      user={{ name: auth.user.name, email: auth.user.email }}
      workspaces={workspaces}
    >
      <PlatformNotice />
      <DemoFrame editionId={edition.id}>{children}</DemoFrame>
    </AppShell>
  );
}
