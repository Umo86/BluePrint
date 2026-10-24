'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  FileInput,
  Group,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconFileSpreadsheet } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import type { ImportPlan } from '@/server/services/exhibitor-import';
import { previewImportAction, runImportAction } from '../../../actions';

type Option = { value: string; label: string };

export function ImportWizard({ editionId, types, isDraft }: { editionId: string; types: Option[]; isDraft: boolean }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [defaultTypeId, setDefaultTypeId] = useState<string | null>(null);
  const [sendInvites, setSendInvites] = useState(false);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [show, setShow] = useState<'all' | 'error'>('all');
  const preview = useAction(previewImportAction, { onSuccess: (p) => setPlan(p ?? null) });
  const run = useAction(runImportAction, {
    onSuccess: (r) => {
      notifications.show({ color: 'green', title: 'Import finished', message: r?.summary ?? 'Done.', autoClose: 10_000 });
      router.push(`/manage/${editionId}/exhibitors`);
    },
  });

  const form = () => {
    const fd = new FormData();
    if (file) fd.set('file', file);
    if (defaultTypeId) fd.set('defaultTypeId', defaultTypeId);
    fd.set('sendInvites', String(sendInvites && !isDraft));
    return fd;
  };
  const rows = useMemo(() => (plan ? (show === 'error' ? plan.rows.filter((r) => r.action === 'error') : plan.rows) : []), [plan, show]);
  const importable = plan ? plan.summary.create + plan.summary.update : 0;

  return (
    <Stack>
      <Paper withBorder p="md">
        <SimpleGrid cols={{ base: 1, md: 3 }}>
          <FileInput
            label="Spreadsheet"
            placeholder="Choose .xlsx or .csv"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            leftSection={<IconFileSpreadsheet size={16} />}
            value={file}
            onChange={(f) => {
              setFile(f);
              setPlan(null);
            }}
            clearable
          />
          <Select
            label="If a row has no stand type, use"
            placeholder="Leave it as a problem"
            data={types}
            value={defaultTypeId}
            onChange={(v) => {
              setDefaultTypeId(v);
              setPlan(null);
            }}
            clearable
          />
          <Checkbox
            mt={{ md: 28 }}
            label="Send invitations straight away"
            description={isDraft ? 'The show is a draft, so invitations will be saved and sent once it is live.' : 'Otherwise they are saved for you to send later.'}
            checked={sendInvites && !isDraft}
            disabled={isDraft}
            onChange={(e) => setSendInvites(e.currentTarget.checked)}
          />
        </SimpleGrid>
        <Group mt="md">
          <Button disabled={!file} loading={preview.pending} onClick={() => preview.run(editionId, form())}>
            Check the file
          </Button>
        </Group>
      </Paper>

      {plan ? (
        <Paper withBorder p="md">
          {plan.missingColumns.length ? (
            <Alert color="red" title="Some columns are missing">
              The file needs these columns: {plan.missingColumns.join(', ')}. Columns found: {plan.recognisedColumns.join(', ') || 'none we recognise'}.
            </Alert>
          ) : (
            <Stack>
              <Group gap="xs">
                <Badge size="lg" variant="light" color="green">
                  {plan.summary.create} new stands
                </Badge>
                <Badge size="lg" variant="light" color="blue">
                  {plan.summary.update} updated
                </Badge>
                <Badge size="lg" variant="light" color="grape">
                  {plan.summary.newCompanies} new companies
                </Badge>
                <Badge size="lg" variant="light" color="teal">
                  {plan.summary.invites} invitations
                </Badge>
                <Badge size="lg" variant="light" color={plan.summary.errors ? 'red' : 'gray'}>
                  {plan.summary.errors} with problems
                </Badge>
              </Group>
              {plan.newHalls.length ? <Text fz="sm">New halls will be added: {plan.newHalls.join(', ')}.</Text> : null}
              {plan.summary.errors ? (
                <Alert color="yellow">Rows with problems are skipped. Fix them in the spreadsheet and import again, or import the rest now.</Alert>
              ) : null}
              <SegmentedControl
                value={show}
                onChange={(v) => setShow(v as 'all' | 'error')}
                data={[
                  { value: 'all', label: `All rows (${plan.rows.length})` },
                  { value: 'error', label: `Problems (${plan.summary.errors})` },
                ]}
                style={{ alignSelf: 'flex-start' }}
              />
              <ScrollArea.Autosize mah={480}>
                <Table fz="sm" verticalSpacing={6} stickyHeader>
                  <TableThead>
                    <TableTr>
                      <TableTh>Line</TableTh>
                      <TableTh>Company</TableTh>
                      <TableTh>Stand</TableTh>
                      <TableTh>Type</TableTh>
                      <TableTh>Hall</TableTh>
                      <TableTh>Contact</TableTh>
                      <TableTh>What happens</TableTh>
                    </TableTr>
                  </TableThead>
                  <TableTbody>
                    {rows.map((r) => (
                      <TableTr key={r.line} bg={r.action === 'error' ? 'var(--mantine-color-red-0)' : undefined}>
                        <TableTd>{r.line}</TableTd>
                        <TableTd>
                          {r.company || '—'}
                          {r.action !== 'error' ? (
                            <Text fz="xs" c="dimmed">
                              {r.companyAction === 'existing' ? 'Existing company' : 'New company'}
                            </Text>
                          ) : null}
                        </TableTd>
                        <TableTd>{r.stand || '—'}</TableTd>
                        <TableTd>{r.typeName || '—'}</TableTd>
                        <TableTd>{r.hall || '—'}</TableTd>
                        <TableTd>{r.contactEmail || '—'}</TableTd>
                        <TableTd>
                          <Badge size="sm" variant="light" color={r.action === 'error' ? 'red' : r.action === 'update' ? 'blue' : 'green'}>
                            {r.action === 'error' ? 'Skipped' : r.action === 'update' ? 'Update' : 'Add'}
                          </Badge>
                          {r.invite ? (
                            <Badge size="sm" variant="light" color="teal" ml={4}>
                              Invite
                            </Badge>
                          ) : null}
                          {r.messages.map((m) => (
                            <Text key={m} fz="xs" c={r.action === 'error' ? 'red' : 'dimmed'}>
                              {m}
                            </Text>
                          ))}
                        </TableTd>
                      </TableTr>
                    ))}
                  </TableTbody>
                </Table>
              </ScrollArea.Autosize>
              <Group>
                <Button loading={run.pending} disabled={!importable} onClick={() => run.run(editionId, form())}>
                  Import {importable} {importable === 1 ? 'row' : 'rows'}
                </Button>
                <Text fz="xs" c="dimmed">
                  {sendInvites && !isDraft ? `${plan.summary.invites} invitations will be emailed now.` : `${plan.summary.invites} invitations will be saved, not sent.`}
                </Text>
              </Group>
            </Stack>
          )}
        </Paper>
      ) : null}
    </Stack>
  );
}
