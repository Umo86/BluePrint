import { Group, Paper, Stack, Text } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { PageHeader } from '@/components/ui/page-header';
import { ButtonLink, DownloadButton } from '@/components/links';
import { ActionButton } from '@/components/action-button';
import { EXHIBITOR_FILTERS, PROGRESS_FILTERS, listExhibitors } from '@/server/services/stands';
import { listExhibitorTypes, listHalls } from '@/server/services/show-setup';
import { shopCategoriesForFilters } from '@/server/services/catalogue';
import { plural } from '@/lib/format';
import { sendUnsentInvitesAction } from '../../actions';
import { loadEdition } from '../load';
import { AddExhibitorButton, ExhibitorFilters } from './exhibitor-controls';
import { ExhibitorTable } from './exhibitor-table';

function one(v: string | string[] | undefined) {
  return typeof v === 'string' ? v.slice(0, 200) : undefined;
}

function pick<T extends readonly string[]>(list: T, v: string | undefined, fallback: T[number]): T[number] {
  return v && (list as readonly string[]).includes(v) ? (v as T[number]) : fallback;
}

export default async function ExhibitorsPage({ params, searchParams }: PageProps<'/manage/[editionId]/exhibitors'>) {
  const { editionId } = await params;
  const { actor, edition, access } = await loadEdition(editionId);
  const sp = await searchParams;
  const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
  const filters = {
    q: one(sp.q),
    typeId: uuid(one(sp.type)),
    hallId: uuid(one(sp.hall)),
    state: pick(EXHIBITOR_FILTERS, one(sp.state), 'all'),
    progress: pick(PROGRESS_FILTERS, one(sp.progress), 'any'),
    taskNotDoneId: uuid(one(sp.task)),
    notOrderedCategoryId: uuid(one(sp.notOrdered)),
  };
  const [{ rows, summary, progress }, types, halls, categories] = await Promise.all([
    listExhibitors(actor, edition.id, filters),
    listExhibitorTypes(actor, edition.id),
    listHalls(actor, edition.id),
    shopCategoriesForFilters(actor, edition.id),
  ]);
  const p = access.permissions;
  const canManage = p.has('manage_exhibitors') && !actor.readOnly;
  const canExport = p.has('manage_exhibitors') || p.has('view_reports');
  const base = `/manage/${edition.id}`;
  // The download uses the same filters as the list on screen.
  const query = new URLSearchParams();
  for (const k of ['q', 'type', 'hall', 'state', 'progress', 'task', 'notOrdered']) {
    const v = one(sp[k]);
    if (v) query.set(k, v);
  }
  const filtered = query.size > 0;
  return (
    <Stack>
      <PageHeader
        title="Exhibitors"
        description={`${plural(summary.companies, 'company', 'companies')} exhibiting. ${summary.joined} signed up, ${summary.invited} invited, ${summary.notSent} invitations not sent yet, ${summary.noContact} with no contact.`}
        actions={
          <Group gap="xs">
            {canExport ? (
              <DownloadButton href={`${base}/reports/exhibitors${query.size ? `?${query}` : ''}`} variant="default" leftSection={<IconDownload size={16} />}>
                {filtered ? 'Download this list' : 'Download (Excel)'}
              </DownloadButton>
            ) : null}
            {canManage && summary.notSent ? (
              <ActionButton
                action={sendUnsentInvitesAction}
                args={[edition.id]}
                variant="light"
                confirm={{
                  title: `Send ${plural(summary.notSent, 'invitation')}?`,
                  body: 'Each saved contact gets an email with their personal link to BluePrint.',
                  confirmLabel: 'Send invitations',
                }}
              >
                Send {plural(summary.notSent, 'saved invitation')}
              </ActionButton>
            ) : null}
            {canManage ? (
              <>
                <ButtonLink href={`${base}/exhibitors/import`} variant="default">
                  Import
                </ButtonLink>
                <AddExhibitorButton
                  editionId={edition.id}
                  types={types.map((t) => ({ value: t.id, label: t.name }))}
                  halls={halls.map((h) => ({ value: h.id, label: h.name }))}
                  isDraft={edition.status === 'draft'}
                />
              </>
            ) : null}
          </Group>
        }
      />
      <ExhibitorFilters
        types={types.map((t) => ({ value: t.id, label: `${t.name} (${t.standCount})` }))}
        halls={halls.map((h) => ({ value: h.id, label: h.name }))}
        tasks={progress.tasks.filter((t) => t.applies > 0).map((t) => ({ value: t.id, label: t.title }))}
        categories={categories.map((c) => ({ value: c.id, label: c.name }))}
        counts={{ all: summary.companies, joined: summary.joined, invited: summary.invited, not_sent: summary.notSent, no_contact: summary.noContact, never_signed_in: summary.neverSignedIn }}
      />
      {filtered ? (
        <Text fz="sm" c="dimmed">
          Showing {plural(rows.length, 'company', 'companies')} of {summary.companies}.
        </Text>
      ) : null}
      {rows.length ? (
        <ExhibitorTable
          editionId={edition.id}
          canEmail={p.has('send_emails') && !actor.readOnly}
          canExport={canExport}
          canSeeOrders={p.has('manage_orders') || p.has('view_reports')}
          rows={rows.map((r) => ({
            companyId: r.company.id,
            companyName: r.company.name,
            stands: r.stands.map((s) => ({ id: s.id, number: s.number, typeName: s.typeName, isSpaceOnly: s.isSpaceOnly, hallName: s.hallName, packStatus: s.packStatus })),
            contact: r.mainContact ? { name: r.mainContact.name, email: r.mainContact.email } : null,
            inviteEmail: r.invite?.email ?? null,
            state: r.state,
            lastLoginAt: r.lastLoginAt?.toISOString() ?? null,
            inviteSentAt: r.invite?.sentAt?.toISOString() ?? null,
            progress: { ...r.progress, nextDeadline: r.progress.nextDeadline?.toISOString() ?? null },
            spend: r.spend,
          }))}
        />
      ) : (
        <Paper withBorder>
          <Text p="md" c="dimmed" fz="sm">
            {summary.companies ? 'No exhibitors match these filters.' : 'No exhibitors yet. Add them one by one or import a spreadsheet.'}
          </Text>
        </Paper>
      )}
    </Stack>
  );
}
