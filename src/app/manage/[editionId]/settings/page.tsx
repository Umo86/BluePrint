import { Stack } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { listExhibitorTypes, listHalls } from '@/server/services/show-setup';
import { getFile } from '@/server/services/files';
import { DEFAULT_SPACE_ONLY_RULES } from '@/server/services/editions';
import { getPlatformSettings } from '@/server/services/settings';
import { toLocalDateTimeString } from '@/lib/dates';
import { loadEdition } from '../load';
import { SettingsTabs } from './settings-tabs';

export default async function SettingsPage({ params, searchParams }: PageProps<'/manage/[editionId]/settings'>) {
  const { editionId } = await params;
  const { actor, edition, access, isAdmin } = await loadEdition(editionId, 'settings');
  const sp = await searchParams;
  const p = access.permissions;
  const tabs = [
    ...(isAdmin ? ['details'] : []),
    ...(p.has('edit_content') ? ['branding', 'contacts'] : []),
    ...(isAdmin ? ['types'] : []),
    ...(p.has('manage_exhibitors') ? ['halls'] : []),
    ...(isAdmin ? ['email', 'space_only'] : []),
  ];
  const requested = typeof sp.tab === 'string' ? sp.tab : '';
  const initialTab = tabs.includes(requested) ? requested : tabs[0];
  const [types, halls, platform] = await Promise.all([listExhibitorTypes(actor, edition.id), listHalls(actor, edition.id), getPlatformSettings()]);
  const logo = edition.branding.logoFileId ? await getFile(edition.branding.logoFileId) : null;
  const header = edition.branding.headerImageFileId ? await getFile(edition.branding.headerImageFileId) : null;
  return (
    <Stack>
      <PageHeader title="Show settings" description="How this edition looks, who exhibitors can contact, its stand types and halls, who emails come from and the rules for space-only stands." />
      <SettingsTabs
        editionId={edition.id}
        tabs={tabs}
        initialTab={initialTab}
        details={{
          id: edition.id,
          name: edition.name,
          slug: edition.slug,
          venue: edition.venue ?? '',
          city: edition.city ?? '',
          status: edition.status,
          vatRateBps: edition.vatRateBps,
          assistantEnabled: edition.assistantEnabled,
          buildUpStartsAt: toLocalDateTimeString(edition.buildUpStartsAt),
          openStartsAt: toLocalDateTimeString(edition.openStartsAt),
          openEndsAt: toLocalDateTimeString(edition.openEndsAt),
          breakdownEndsAt: toLocalDateTimeString(edition.breakdownEndsAt),
        }}
        allowArchive={access.role === 'super_admin'}
        branding={{
          primaryColor: edition.branding.primaryColor ?? '#2e52af',
          accentColor: edition.branding.accentColor ?? '#f08c00',
          footerText: edition.branding.footerText ?? '',
          logo: logo && !logo.deletedAt ? { fileId: logo.id, url: `/files/${logo.id}`, name: logo.originalName } : null,
          header: header && !header.deletedAt ? { fileId: header.id, url: `/files/${header.id}`, name: header.originalName } : null,
          editionName: edition.name,
        }}
        types={types.map((t) => ({ id: t.id, key: t.key, name: t.name, description: t.description ?? '', isSpaceOnly: t.isSpaceOnly, builtIn: t.builtIn, standCount: t.standCount }))}
        halls={halls.map((h) => ({ id: h.id, name: h.name, standCount: h.standCount }))}
        email={{
          senderName: edition.emailSettings.senderName ?? '',
          senderAddress: edition.emailSettings.senderAddress ?? '',
          replyTo: edition.emailSettings.replyTo ?? '',
          campaignSenderAddress: edition.emailSettings.campaignSenderAddress ?? '',
          platformDefault: platform.emailDefaults.senderAddress || 'the platform default',
        }}
        spaceOnly={edition.spaceOnlyRules ?? DEFAULT_SPACE_ONLY_RULES}
        contacts={edition.contacts.map((c) => ({ id: c.id, team: c.team, name: c.name ?? '', email: c.email ?? '', phone: c.phone ?? '', note: c.note ?? '' }))}
      />
    </Stack>
  );
}
