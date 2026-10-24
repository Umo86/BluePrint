import { Alert } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { getPlatformSettings } from '@/server/services/settings';

/** The notice a super admin can show on every page (for example planned maintenance). */
export async function PlatformNotice() {
  const { maintenanceMessage } = await getPlatformSettings();
  if (!maintenanceMessage.trim()) return null;
  return (
    <Alert color="blue" icon={<IconInfoCircle size={18} />} mb="md" role="status">
      {maintenanceMessage}
    </Alert>
  );
}
