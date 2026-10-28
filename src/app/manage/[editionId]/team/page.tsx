import { Stack } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { StaffManager } from '@/components/staff-manager';
import { listEditionStaff } from '@/server/services/staff';
import { loadEdition } from '../load';

export default async function TeamPage({ params }: PageProps<'/manage/[editionId]/team'>) {
  const { editionId } = await params;
  const { actor, edition } = await loadEdition(editionId, 'show_admin');
  const team = await listEditionStaff(actor, edition.id);
  return (
    <Stack>
      <PageHeader
        title="Team"
        description="Who works on this show and what each person can do. Tick a box to give someone a right; it saves straight away. Show admins can do everything; give team members only the areas they need."
      />
      <StaffManager
        editionId={edition.id}
        staff={team.staff.map((s) => ({ userId: s.user.id, name: s.user.name, email: s.user.email, jobTitle: s.user.jobTitle, role: s.role, permissions: s.permissions }))}
        pending={team.pending.map((p) => ({ id: p.id, email: p.email, role: p.role ?? '', expiresAt: p.expiresAt.toISOString() }))}
        currentUserId={actor.realUserId}
        viewerIsSuperAdmin={actor.isSuperAdmin && !actor.readOnly}
      />
    </Stack>
  );
}
