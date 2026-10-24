import { Stack } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { TextLink } from '@/components/links';
import { audienceOptions } from '@/server/services/campaigns';
import { loadEdition } from '../../../load';
import { CampaignEditor } from '../campaign-editor';

export default async function NewCampaign({ params }: PageProps<'/manage/[editionId]/emails/campaigns/new'>) {
  const { editionId } = await params;
  const { actor, edition } = await loadEdition(editionId, 'send_emails');
  const options = await audienceOptions(actor, edition.id);
  return (
    <Stack>
      <TextLink href={`/manage/${edition.id}/emails?tab=campaigns`} fz="sm">
        ← Updates to exhibitors
      </TextLink>
      <PageHeader title="New email to exhibitors" description="Write it, choose who gets it, send yourself a test, then send it now or schedule it." />
      <CampaignEditor
        editionId={edition.id}
        campaignId={null}
        editable
        options={options}
        initial={{
          name: '',
          subject: '',
          blocks: [
            { type: 'heading', text: 'Hello {{first_name}}' },
            { type: 'paragraph', text: '' },
            { type: 'button', label: 'Open your exhibitor portal', url: '{{portal_link}}' },
          ],
          filter: { exhibitorTypeIds: [], hallIds: [], taskNotDoneId: null, categoryNotOrderedId: null, neverSignedIn: false, standIds: [], audience: 'main_contacts' },
        }}
      />
    </Stack>
  );
}
