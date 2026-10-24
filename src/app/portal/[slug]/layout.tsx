import { IconBook2, IconBuildingStore, IconChecklist, IconHome } from '@tabler/icons-react';
import { AppShell, type NavItem } from '@/components/app-shell';
import { PlatformNotice } from '@/components/platform-notice';
import { getCurrentAuth } from '@/server/auth/current';
import { getWorkspaces } from '@/server/services/workspaces';
import { checklistForStand } from '@/server/services/submissions';
import { loadPortal } from './load';
import { StandSwitcher } from './stand-switcher';

export default async function PortalLayout({ children, params }: LayoutProps<'/portal/[slug]'>) {
  const { slug } = await params;
  const ctx = await loadPortal(slug);
  const auth = (await getCurrentAuth())!;
  const workspaces = await getWorkspaces(auth.actor);
  const checklist = await checklistForStand(ctx.actor, ctx.stand.id);
  const toDo = checklist.items.filter((i) => !i.done && i.state !== 'submitted').length;
  const base = `/portal/${ctx.edition.slug}`;
  const nav: NavItem[] = [
    { label: 'Home', href: base, exact: true, icon: <IconHome size={18} /> },
    { label: 'Your checklist', href: `${base}/checklist`, icon: <IconChecklist size={18} />, badge: toDo || null },
    { label: 'Exhibitor manual', href: `${base}/manual`, icon: <IconBook2 size={18} /> },
    { label: 'Your company and team', href: `${base}/company`, icon: <IconBuildingStore size={18} /> },
  ];
  const logoUrl = ctx.edition.branding.logoFileId ? `/files/${ctx.edition.branding.logoFileId}` : null;
  return (
    <AppShell
      title={ctx.edition.name}
      subtitle={`${ctx.stand.companyName} · stand ${ctx.stand.number}`}
      nav={nav}
      user={{ name: auth.user.name, email: auth.user.email }}
      workspaces={workspaces}
      viewAs={auth.viewAsUser ? { name: auth.viewAsUser.name, email: auth.viewAsUser.email } : null}
      brand={{ color: ctx.edition.branding.primaryColor ?? null, logoUrl }}
      headerExtra={
        ctx.stands.length > 1 ? (
          <StandSwitcher slug={ctx.edition.slug} current={ctx.stand.id} stands={ctx.stands.map((s) => ({ id: s.id, label: `${s.companyName} · ${s.number}` }))} />
        ) : null
      }
    >
      <PlatformNotice />
      {children}
    </AppShell>
  );
}
