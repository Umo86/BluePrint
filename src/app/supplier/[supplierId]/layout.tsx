import { IconBuildingWarehouse, IconCash, IconLayoutDashboard, IconPackage, IconReceipt } from '@tabler/icons-react';
import { AppShell } from '@/components/app-shell';
import { PlatformNotice } from '@/components/platform-notice';
import { getCurrentAuth } from '@/server/auth/current';
import { getWorkspaces } from '@/server/services/workspaces';
import { loadSupplier } from './load';

export default async function SupplierLayout({ children, params }: LayoutProps<'/supplier/[supplierId]'>) {
  const { supplierId } = await params;
  const { actor, supplier } = await loadSupplier(supplierId);
  const auth = (await getCurrentAuth())!;
  const workspaces = await getWorkspaces(actor);
  const base = `/supplier/${supplier.id}`;
  return (
    <AppShell
      title={supplier.name}
      subtitle="Supplier portal"
      nav={[
        { label: 'Overview', href: base, exact: true, icon: <IconLayoutDashboard size={18} /> },
        { label: 'Orders', href: `${base}/orders`, icon: <IconReceipt size={18} /> },
        { label: 'Catalogue', href: `${base}/catalogue`, icon: <IconPackage size={18} /> },
        { label: 'Payouts', href: `${base}/payouts`, icon: <IconCash size={18} /> },
        { label: 'Your details', href: `${base}/details`, icon: <IconBuildingWarehouse size={18} /> },
      ]}
      user={{ name: auth.user.name, email: auth.user.email }}
      workspaces={workspaces}
      viewAs={auth.viewAsUser ? { name: auth.viewAsUser.name, email: auth.viewAsUser.email } : null}
    >
      <PlatformNotice />
      {children}
    </AppShell>
  );
}
