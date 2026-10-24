import { Stack } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { TextLink } from '@/components/links';
import { listSavedReplies } from '@/server/services/helpdesk';
import { loadEdition } from '../../load';
import { SavedRepliesEditor } from './saved-replies-editor';

export default async function SavedReplies({ params }: PageProps<'/manage/[editionId]/help-desk/saved-replies'>) {
  const { editionId } = await params;
  const { actor, edition } = await loadEdition(editionId, 'helpdesk');
  const replies = await listSavedReplies(actor, edition.id);
  return (
    <Stack>
      <TextLink href={`/manage/${edition.id}/help-desk`} fz="sm">
        ← Help desk
      </TextLink>
      <PageHeader title="Saved replies" description="Answers your team gives often. Insert one into a reply and adjust it before sending." />
      <SavedRepliesEditor editionId={edition.id} replies={replies.map((r) => ({ id: r.id, title: r.title, body: r.body }))} canEdit={!actor.readOnly} />
    </Stack>
  );
}
