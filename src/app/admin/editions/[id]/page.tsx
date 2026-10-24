import { notFound } from 'next/navigation';
import { Group, Stack } from '@mantine/core';
import { ButtonLink } from '@/components/links';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { requireSuperAdmin } from '@/server/auth/current';
import { getEdition } from '@/server/services/editions';
import { listEditionStaff } from '@/server/services/staff';
import { getPlatformSettings } from '@/server/services/settings';
import { toLocalDateTimeString } from '@/lib/dates';
import { EditionTabs } from './edition-tabs';

export default async function EditionAdminPage({ params }: PageProps<'/admin/editions/[id]'>) {
  const { id } = await params;
  const actor = await requireSuperAdmin();
  const found = await getEdition(id);
  if (!found) notFound();
  const { edition, show } = found;
  const team = await listEditionStaff(actor, id);
  const settings = await getPlatformSettings();
  return (
    <Stack>
      <PageHeader
        eyebrow={show.name}
        title={edition.name}
        description={[edition.venue, edition.city].filter(Boolean).join(', ') || undefined}
        actions={
          <Group gap="xs">
            <StatusBadge status={edition.status} />
            <ButtonLink href={`/manage/${edition.id}`} variant="light">
              Open show dashboard
            </ButtonLink>
          </Group>
        }
      />
      <EditionTabs
        edition={{
          id: edition.id,
          name: edition.name,
          slug: edition.slug,
          venue: edition.venue ?? '',
          city: edition.city ?? '',
          status: edition.status,
          vatRateBps: edition.vatRateBps,
          buildUpStartsAt: toLocalDateTimeString(edition.buildUpStartsAt),
          openStartsAt: toLocalDateTimeString(edition.openStartsAt),
          openEndsAt: toLocalDateTimeString(edition.openEndsAt),
          breakdownEndsAt: toLocalDateTimeString(edition.breakdownEndsAt),
          feeMode: edition.feeMode,
          defaultCommissionType: edition.defaultCommissionType,
          defaultCommissionValue: edition.defaultCommissionValue,
        }}
        platformFeeMode={settings.feeMode}
        platformCommission={{ type: settings.defaultCommissionType, value: settings.defaultCommissionValue }}
        staff={team.staff.map((s) => ({ userId: s.user.id, name: s.user.name, email: s.user.email, role: s.role, permissions: s.permissions }))}
        pending={team.pending.map((p) => ({ id: p.id, email: p.email, role: p.role ?? '', expiresAt: p.expiresAt.toISOString() }))}
        currentUserId={actor.realUserId}
      />
    </Stack>
  );
}
