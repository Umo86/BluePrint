import { Stack } from '@mantine/core';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { TextLink } from '@/components/links';
import { templateForEdit } from '@/server/services/email-admin';
import { AppError } from '@/server/errors';
import { loadEdition } from '../../../load';
import { TemplateEditor } from './template-editor';

export default async function TemplatePage({ params }: PageProps<'/manage/[editionId]/emails/templates/[key]'>) {
  const { editionId, key } = await params;
  const { actor, edition } = await loadEdition(editionId, 'send_emails');
  let t: Awaited<ReturnType<typeof templateForEdit>>;
  try {
    t = await templateForEdit(actor, edition.id, key);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
  return (
    <Stack>
      <TextLink href={`/manage/${edition.id}/emails`} fz="sm">
        ← Emails
      </TextLink>
      <PageHeader title={t.name} description={t.description} />
      <TemplateEditor editionId={edition.id} templateKey={t.key} initial={t.content} custom={t.custom} variables={t.variables} allowTasksDue={t.allowTasksDue} />
    </Stack>
  );
}
