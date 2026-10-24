import { Stack } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { requireSuperAdmin } from '@/server/auth/current';
import { listLibrary } from '@/server/services/library';
import { LibraryManager } from './library-manager';

export default async function LibraryPage() {
  const actor = await requireSuperAdmin();
  const items = await listLibrary(actor);
  return (
    <Stack>
      <PageHeader
        title="Library"
        description="Templates any show team can pull into their edition: manual pages, tasks and forms, email templates and service catalogues. Show teams can use them; only super admins can change them."
      />
      <LibraryManager
        items={items.map((i) => ({
          id: i.id,
          kind: i.kind,
          name: i.name,
          description: i.description ?? '',
          data: i.data,
          updatedAt: i.updatedAt.toISOString(),
        }))}
      />
    </Stack>
  );
}
