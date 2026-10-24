import { Stack } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { requireSuperAdmin } from '@/server/auth/current';
import { getPlatformSettings } from '@/server/services/settings';
import { SettingsForms } from './settings-forms';

export default async function SettingsPage() {
  await requireSuperAdmin();
  const settings = await getPlatformSettings();
  return (
    <Stack>
      <PageHeader title="Platform settings" description="Defaults for every show. Each edition can override fees and commission on its own settings page." />
      <SettingsForms settings={settings} />
    </Stack>
  );
}
