import { List, ListItem, Paper, Stack, Text, Title } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { DownloadButton } from '@/components/links';
import { listExhibitorTypes } from '@/server/services/show-setup';
import { loadEdition } from '../../load';
import { ImportWizard } from './import-wizard';

export default async function ImportPage({ params }: PageProps<'/manage/[editionId]/exhibitors/import'>) {
  const { editionId } = await params;
  const { actor, edition } = await loadEdition(editionId, 'manage_exhibitors');
  const types = await listExhibitorTypes(actor, edition.id);
  return (
    <Stack>
      <PageHeader
        title="Import exhibitors"
        description="Add or update many exhibitors and stands at once from a spreadsheet. You see exactly what will happen before anything changes."
        actions={
          <DownloadButton href={`/manage/${edition.id}/exhibitors/import/template`} variant="default">
            Download a template
          </DownloadButton>
        }
      />
      <Paper withBorder p="md">
        <Title order={2} fz="md" mb="xs">
          What the file needs
        </Title>
        <List size="sm" spacing={4}>
          <ListItem>An Excel file (.xlsx) or CSV with a heading row. Only the first sheet is read.</ListItem>
          <ListItem>
            <Text span fw={600} fz="sm">
              Company
            </Text>{' '}
            and{' '}
            <Text span fw={600} fz="sm">
              Stand
            </Text>{' '}
            columns are required. Optional: Type ({types.map((t) => t.name).join(', ')}), Hall, Size (sqm), Open sides, Contact name, Contact email, Phone, Website, VAT number, Exhibitor ID.
          </ListItem>
          <ListItem>Companies already in BluePrint are matched by exact name (or exhibitor ID), so last year’s record is reused.</ListItem>
          <ListItem>Stands that already exist are updated. New halls are created for you.</ListItem>
          <ListItem>Each company’s contact gets an invitation, unless someone from the company is already on BluePrint.</ListItem>
        </List>
      </Paper>
      <ImportWizard editionId={edition.id} types={types.map((t) => ({ value: t.id, label: t.name }))} isDraft={edition.status === 'draft'} />
    </Stack>
  );
}
