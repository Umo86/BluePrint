import { notFound } from 'next/navigation';
import { Alert, Anchor, Badge, Group, Paper, SimpleGrid, Stack, Table, TableTbody, TableTd, TableTh, TableTr, Text, Title } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { DownloadButton, TextLink } from '@/components/links';
import { packForReview } from '@/server/services/space-only';
import { AppError } from '@/server/errors';
import { checkPack, PACK_STATUS_LABELS, SPACE_ONLY_DOC_LABELS } from '@/lib/space-only';
import { dateTime } from '@/lib/format';
import { formatBytes } from '@/lib/upload-rules';
import { loadEdition } from '../../load';
import { ReviewForm } from './review-form';

export default async function ReviewPackPage({ params }: PageProps<'/manage/[editionId]/space-only/[standId]'>) {
  const { editionId, standId } = await params;
  const { actor, edition } = await loadEdition(editionId, 'space_only');
  if (!/^[0-9a-f-]{36}$/i.test(standId)) notFound();
  let d: Awaited<ReturnType<typeof packForReview>>;
  try {
    d = await packForReview(actor, standId);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
  if (d.stand.editionId !== edition.id) notFound();
  const status = PACK_STATUS_LABELS[d.pack?.status ?? 'not_started'];
  const latest = d.versions[0];
  const declared = latest ? (latest.declarations as Record<string, unknown>) : null;
  const check = latest
    ? checkPack(
        d.rules,
        {
          heightM: (declared?.heightM as number) ?? null,
          platformMm: (declared?.platformMm as number) ?? null,
          hasSteps: Boolean(declared?.hasSteps),
          insuranceCoverGbp: (declared?.insuranceCoverGbp as number) ?? null,
          insuranceExpiresOn: (declared?.insuranceExpiresOn as string) ?? null,
        },
        latest.documents as Record<string, string[]>,
        { breakdownEndsAt: edition.breakdownEndsAt },
      )
    : null;
  return (
    <Stack>
      <TextLink href={`/manage/${edition.id}/space-only`} fz="sm">
        ← Space-only approvals
      </TextLink>
      <PageHeader
        eyebrow="Space-only stand"
        title={`Stand ${d.stand.number} · ${d.company?.name ?? ''}`}
        actions={
          <Group gap="xs">
            <Badge size="lg" variant="light" color={status.color}>
              {status.label}
            </Badge>
            {d.pack?.certificateFileId ? (
              <DownloadButton href={`/files/${d.pack.certificateFileId}?download=1`} variant="light" color="green">
                Permission to build (PDF)
              </DownloadButton>
            ) : null}
          </Group>
        }
      />
      <SimpleGrid cols={{ base: 1, lg: 3 }}>
        <Stack style={{ gridColumn: 'span 2' }}>
          {!latest ? (
            <Alert color="gray">Nothing has been sent for this stand yet.</Alert>
          ) : (
            <>
              <Paper withBorder p="md">
                <Group justify="space-between" mb="sm">
                  <Title order={2} fz="md">
                    Version {latest.version}
                  </Title>
                  <Text fz="sm" c="dimmed">
                    Sent {dateTime(latest.submittedAt)}
                  </Text>
                </Group>
                <Table variant="vertical">
                  <TableTbody>
                    <TableTr>
                      <TableTh w={240}>Highest point</TableTh>
                      <TableTd>{declared?.heightM !== null && declared?.heightM !== undefined ? `${declared.heightM} m` : '—'} (limit {d.rules.maxHeightM} m)</TableTd>
                    </TableTr>
                    <TableTr>
                      <TableTh>Platform</TableTh>
                      <TableTd>{declared?.platformMm !== null && declared?.platformMm !== undefined ? `${declared.platformMm} mm` : '—'} (limit {d.rules.maxPlatformMm} mm)</TableTd>
                    </TableTr>
                    <TableTr>
                      <TableTh>Steps or second level</TableTh>
                      <TableTd>{declared?.hasSteps ? 'Yes' : 'No'}</TableTd>
                    </TableTr>
                    <TableTr>
                      <TableTh>Insurance cover</TableTh>
                      <TableTd>
                        {typeof declared?.insuranceCoverGbp === 'number' ? `£${(declared.insuranceCoverGbp as number).toLocaleString('en-GB')}` : '—'}, expires {String(declared?.insuranceExpiresOn ?? '—')}
                      </TableTd>
                    </TableTr>
                  </TableTbody>
                </Table>
                {check?.isComplex ? (
                  <Alert color="orange" mt="sm">
                    Complex stand: {check.complexReasons.join(', ')}.
                  </Alert>
                ) : null}
                {check && check.missing.length ? (
                  <Alert color="red" mt="sm" title="Now missing under the current rules">
                    {check.missing.join('; ')}
                  </Alert>
                ) : null}
              </Paper>
              <Paper withBorder p="md">
                <Title order={2} fz="md" mb="sm">
                  Documents
                </Title>
                <Stack gap="xs">
                  {Object.entries(latest.documents as Record<string, string[]>).map(([key, ids]) => (
                    <div key={key}>
                      <Text fz="sm" fw={600}>
                        {SPACE_ONLY_DOC_LABELS[key] ?? key}
                      </Text>
                      {ids.map((fid) => (
                        <Group key={fid} gap="xs">
                          <Anchor href={`/files/${fid}`} target="_blank" fz="sm">
                            {d.files[fid]?.name ?? 'Document'}
                          </Anchor>
                          {d.files[fid] ? (
                            <Text fz="xs" c="dimmed">
                              {formatBytes(d.files[fid].size)}
                            </Text>
                          ) : null}
                        </Group>
                      ))}
                    </div>
                  ))}
                </Stack>
              </Paper>
            </>
          )}
          <Paper withBorder p="md">
            <Title order={2} fz="md" mb="sm">
              History
            </Title>
            <Stack gap="xs">
              {d.reviews.map((r) => (
                <Paper key={r.review.id} withBorder p="sm" bg="var(--mantine-color-gray-0)">
                  <Group gap="xs">
                    <Badge size="sm" variant="light">
                      {r.review.reviewerRole === 'hs' ? 'H&S' : 'Ops'}
                    </Badge>
                    <Badge size="sm" variant="light" color={PACK_STATUS_LABELS[r.review.outcome]?.color ?? 'gray'}>
                      {PACK_STATUS_LABELS[r.review.outcome]?.label ?? 'Comment'}
                    </Badge>
                    <Text fz="xs" c="dimmed">
                      {r.reviewer?.name || r.reviewer?.email || 'Someone'} · version {r.review.version} · {dateTime(r.review.createdAt)}
                      {r.review.docType ? ` · ${SPACE_ONLY_DOC_LABELS[r.review.docType] ?? r.review.docType}` : ''}
                    </Text>
                  </Group>
                  {r.review.comment ? (
                    <Text fz="sm" mt={4} style={{ whiteSpace: 'pre-wrap' }}>
                      {r.review.comment}
                    </Text>
                  ) : null}
                </Paper>
              ))}
              {d.versions.map((v) => (
                <Text key={v.id} fz="xs" c="dimmed">
                  Version {v.version} sent {dateTime(v.submittedAt)}
                </Text>
              ))}
              {!d.reviews.length && !d.versions.length ? (
                <Text fz="sm" c="dimmed">
                  Nothing yet.
                </Text>
              ) : null}
            </Stack>
          </Paper>
        </Stack>
        <Stack>
          <Paper withBorder p="md">
            <Title order={2} fz="md" mb="xs">
              Contractor
            </Title>
            {d.contractor ? (
              <>
                <Text fw={600}>{d.contractor.contractorCompanyName}</Text>
                <Text fz="sm">{d.contractor.contactName}</Text>
                <Text fz="sm">{d.contractor.contactEmail}</Text>
                {d.contractor.contactPhone ? <Text fz="sm">{d.contractor.contactPhone}</Text> : null}
                <Badge mt={4} size="sm" variant="light" color={d.contractor.status === 'active' ? 'green' : 'yellow'}>
                  {d.contractor.status === 'active' ? 'On BluePrint' : 'Invited'}
                </Badge>
              </>
            ) : (
              <Text fz="sm" c="dimmed">
                Not nominated yet.
              </Text>
            )}
          </Paper>
          {d.canDecide && d.pack?.currentVersion ? (
            <ReviewForm standId={d.stand.id} status={d.pack.status} docOptions={Object.keys((latest?.documents as Record<string, string[]>) ?? {}).map((k) => ({ value: k, label: SPACE_ONLY_DOC_LABELS[k] ?? k }))} />
          ) : null}
          {d.pack?.conditions ? (
            <Alert color="lime" title="Conditions">
              {d.pack.conditions}
            </Alert>
          ) : null}
        </Stack>
      </SimpleGrid>
    </Stack>
  );
}
