import { Alert, Stack } from '@mantine/core';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { TextLink } from '@/components/links';
import { audienceOptions, getCampaign } from '@/server/services/campaigns';
import { AppError } from '@/server/errors';
import { dateTime } from '@/lib/format';
import { loadEdition } from '../../../load';
import { CampaignEditor, type Filter } from '../campaign-editor';

export default async function CampaignPage({ params }: PageProps<'/manage/[editionId]/emails/campaigns/[campaignId]'>) {
  const { editionId, campaignId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(campaignId)) notFound();
  const { actor, edition } = await loadEdition(editionId, 'send_emails');
  let c: Awaited<ReturnType<typeof getCampaign>>;
  try {
    c = await getCampaign(actor, campaignId);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
  if (c.editionId !== edition.id) notFound();
  const options = await audienceOptions(actor, edition.id);
  const editable = (c.status === 'draft' || c.status === 'scheduled') && !actor.readOnly;
  const f = c.filter;
  const filter: Filter = {
    exhibitorTypeIds: f.exhibitorTypeIds ?? [],
    hallIds: f.hallIds ?? [],
    taskNotDoneId: f.taskNotDoneId ?? null,
    categoryNotOrderedId: f.categoryNotOrderedId ?? null,
    neverSignedIn: Boolean(f.neverSignedIn),
    standIds: f.standIds ?? [],
    audience: f.audience ?? 'main_contacts',
  };
  return (
    <Stack>
      <TextLink href={`/manage/${edition.id}/emails?tab=campaigns`} fz="sm">
        ← Updates to exhibitors
      </TextLink>
      <PageHeader title={c.name} description={c.subject} actions={<StatusBadge status={c.status === 'sending' ? 'running' : c.status} />} />
      {c.status === 'scheduled' && c.scheduledFor ? <Alert color="blue">Scheduled for {dateTime(c.scheduledFor, edition.timezone)}. Changes you save before then are sent.</Alert> : null}
      {c.status === 'sent' ? <Alert color="green">Sent {c.sentAt ? dateTime(c.sentAt, edition.timezone) : ''} to {c.recipients} people.</Alert> : null}
      <CampaignEditor editionId={edition.id} campaignId={c.id} editable={editable} options={options} initial={{ name: c.name, subject: c.subject, blocks: c.blocks, filter }} />
    </Stack>
  );
}
