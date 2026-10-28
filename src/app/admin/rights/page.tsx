import { Group, List, ListItem, Paper, Stack, Text, Title } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { ParamSelect } from '@/components/ui/list-controls';
import { ButtonLink } from '@/components/links';
import { RightsMatrix } from '@/components/rights-matrix';
import { requireSuperAdmin } from '@/server/auth/current';
import { rightsOverview } from '@/server/services/staff';
import { PERMISSION_OPTIONS } from '@/lib/roles';

const STATUS_LABEL: Record<string, string> = { draft: 'being set up', live: 'live', onsite: 'on site', closed: 'closed', archived: 'archived' };

export default async function RightsPage({ searchParams }: PageProps<'/admin/rights'>) {
  const actor = await requireSuperAdmin();
  const sp = await searchParams;
  const r = await rightsOverview(actor, typeof sp.show === 'string' ? sp.show : null);
  return (
    <Stack>
      <PageHeader
        title="Rights"
        description="Everyone who works on your shows and what each person can do. Choose a show, then tick a box to give someone a right; it saves straight away."
      />
      {r.edition ? (
        <>
          <Group justify="space-between" align="flex-end" wrap="wrap">
            <ParamSelect param="show" label="Show" options={r.editions.map((e) => ({ value: e.id, label: `${e.name} (${STATUS_LABEL[e.status] ?? e.status})` }))} width={380} />
            <ButtonLink href={`/manage/${r.edition.id}/team`} variant="default">
              Invite someone new to this show
            </ButtonLink>
          </Group>
          <Paper withBorder p="md">
            <RightsMatrix key={r.edition.id} editionId={r.edition.id} mode="platform" rows={r.people} currentUserId={actor.realUserId} viewerIsSuperAdmin />
          </Paper>
        </>
      ) : (
        <Paper withBorder p="md">
          <Text fz="sm">There are no shows yet. Create a show first, then give people rights in it here.</Text>
        </Paper>
      )}
      <Paper withBorder p="md">
        <Title order={2} fz="md" mb="xs">
          What each right allows
        </Title>
        <List fz="sm" spacing={4}>
          {PERMISSION_OPTIONS.map((p) => (
            <ListItem key={p.value}>
              <Text span fz="sm" fw={600}>
                {p.label}:
              </Text>{' '}
              {p.description}
            </ListItem>
          ))}
          <ListItem>
            <Text span fz="sm" fw={600}>
              Library:
            </Text>{' '}
            save tasks and manual pages from their shows into the shared library, so other shows can copy them. This right covers every show.
          </ListItem>
        </List>
        <Text fz="xs" c="dimmed" mt="sm">
          People who have never been on a show team are not listed here. To bring someone new in, invite them to a show from its Team page.
        </Text>
      </Paper>
    </Stack>
  );
}
