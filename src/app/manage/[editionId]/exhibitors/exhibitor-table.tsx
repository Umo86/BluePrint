'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Checkbox, Group, Paper, Progress, Stack, Table, TableScrollContainer, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDownload, IconMail, IconX } from '@tabler/icons-react';
import { TextLink } from '@/components/links';
import { PACK_STATUS_LABELS } from '@/lib/space-only';
import { useAction } from '@/lib/use-action';
import { emailStandsAction } from '../../email-actions';

export type ExhibitorRow = {
  companyId: string;
  companyName: string;
  stands: { id: string; number: string; typeName: string; isSpaceOnly: boolean; hallName: string | null; packStatus: string | null }[];
  contact: { name: string; email: string } | null;
  inviteEmail: string | null;
  state: 'joined' | 'invited' | 'not_sent' | 'no_contact';
  lastLoginAt: string | null;
  inviteSentAt: string | null;
  progress: { required: number; requiredDone: number; overdue: number; awaitingReview: number; changesNeeded: number; nextDeadline: string | null };
  spend: { orders: number; paidPence: number; unpaidPence: number };
};

const STATE: Record<ExhibitorRow['state'], { label: string; color: string }> = {
  joined: { label: 'Signed up', color: 'green' },
  invited: { label: 'Invited', color: 'blue' },
  not_sent: { label: 'Invitation not sent', color: 'yellow' },
  no_contact: { label: 'No contact yet', color: 'gray' },
};

const pounds = (pence: number) => (pence / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });

const day = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' }) : '');

async function downloadChosen(editionId: string, companyIds: string[]) {
  const res = await fetch(`/manage/${editionId}/reports/exhibitors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyIds }),
  });
  if (!res.ok) {
    notifications.show({
      color: 'red',
      title: 'Not done',
      message: res.status === 429 ? 'You have downloaded a lot of reports in the last hour. Please try again later.' : 'The download did not work. Please try again.',
    });
    return;
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'exhibitors.xlsx';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ExhibitorTable({
  editionId,
  rows,
  canEmail,
  canExport,
  canSeeOrders,
}: {
  editionId: string;
  rows: ExhibitorRow[];
  canEmail: boolean;
  canExport: boolean;
  canSeeOrders: boolean;
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const visible = useMemo(() => new Set(rows.map((r) => r.companyId)), [rows]);
  // Only rows still on screen count (filters may have changed since they were ticked).
  const selected = [...chosen].filter((id) => visible.has(id));
  const allChosen = rows.length > 0 && selected.length === rows.length;
  const email = useAction(emailStandsAction, {
    onSuccess: (data) => {
      if (data?.id) router.push(`/manage/${editionId}/emails/campaigns/${data.id}`);
    },
  });
  const canAct = canEmail || canExport;
  const toggle = (id: string, on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const base = `/manage/${editionId}`;
  return (
    <Stack gap="xs">
      {canAct && selected.length ? (
        <Paper withBorder p="xs" px="md" bg="var(--mantine-color-blue-light)" style={{ position: 'sticky', top: 64, zIndex: 5 }}>
          <Group justify="space-between">
            <Text fz="sm" fw={600}>
              {selected.length} {selected.length === 1 ? 'company' : 'companies'} chosen
            </Text>
            <Group gap="xs">
              {canEmail ? (
                <Button
                  size="xs"
                  leftSection={<IconMail size={14} />}
                  loading={email.pending}
                  onClick={() =>
                    email.run(
                      editionId,
                      rows.filter((r) => chosen.has(r.companyId)).flatMap((r) => r.stands.map((s) => s.id)),
                    )
                  }
                >
                  Email them
                </Button>
              ) : null}
              {canExport ? (
                <Button
                  size="xs"
                  variant="default"
                  leftSection={<IconDownload size={14} />}
                  loading={downloading}
                  onClick={async () => {
                    setDownloading(true);
                    try {
                      await downloadChosen(editionId, selected);
                    } finally {
                      setDownloading(false);
                    }
                  }}
                >
                  Download chosen (Excel)
                </Button>
              ) : null}
              <Button size="xs" variant="subtle" leftSection={<IconX size={14} />} onClick={() => setChosen(new Set())}>
                Clear
              </Button>
            </Group>
          </Group>
        </Paper>
      ) : null}
      <Paper withBorder>
        <TableScrollContainer minWidth={canSeeOrders ? 1050 : 920}>
        <Table verticalSpacing="sm" highlightOnHover>
          <TableThead>
            <TableTr>
              {canAct ? (
                <TableTh w={40}>
                  <Checkbox
                    aria-label="Choose every company in this list"
                    checked={allChosen}
                    indeterminate={selected.length > 0 && !allChosen}
                    onChange={(e) => setChosen(e.currentTarget.checked ? new Set(rows.map((r) => r.companyId)) : new Set())}
                  />
                </TableTh>
              ) : null}
              <TableTh>Company</TableTh>
              <TableTh>Stand</TableTh>
              <TableTh>Main contact</TableTh>
              <TableTh>BluePrint</TableTh>
              <TableTh w={210}>Checklist</TableTh>
              {canSeeOrders ? <TableTh w={130}>Orders</TableTh> : null}
            </TableTr>
          </TableThead>
          <TableTbody>
            {rows.map((r) => {
              const p = r.progress;
              const pctDone = p.required ? Math.floor((p.requiredDone / p.required) * 100) : 0;
              return (
                <TableTr key={r.companyId}>
                  {canAct ? (
                    <TableTd>
                      <Checkbox aria-label={`Choose ${r.companyName}`} checked={chosen.has(r.companyId)} onChange={(e) => toggle(r.companyId, e.currentTarget.checked)} />
                    </TableTd>
                  ) : null}
                  <TableTd>
                    <TextLink href={`${base}/exhibitors/${r.companyId}`} fw={600} fz="sm">
                      {r.companyName}
                    </TextLink>
                  </TableTd>
                  <TableTd>
                    <Stack gap={6}>
                      {r.stands.map((s) => (
                        <Stack key={s.id} gap={2} align="flex-start">
                          <Group gap={6} style={{ rowGap: 2 }}>
                            <Text fz="sm" fw={600}>
                              {s.number}
                            </Text>
                            <Badge size="xs" variant="light" color={s.isSpaceOnly ? 'orange' : 'blue'} style={{ flexShrink: 0 }}>
                              {s.typeName}
                            </Badge>
                            {s.hallName ? (
                              <Text fz="xs" c="dimmed">
                                {s.hallName}
                              </Text>
                            ) : null}
                          </Group>
                          {s.packStatus ? (
                            <Badge size="xs" variant="outline" color={PACK_STATUS_LABELS[s.packStatus]?.color ?? 'gray'} title="Space-only stand pack" style={{ flexShrink: 0 }}>
                              Pack: {PACK_STATUS_LABELS[s.packStatus]?.label ?? s.packStatus}
                            </Badge>
                          ) : null}
                        </Stack>
                      ))}
                    </Stack>
                  </TableTd>
                  <TableTd>
                    {r.contact ? (
                      <>
                        <Text fz="sm">{r.contact.name || r.contact.email}</Text>
                        <Text fz="xs" c="dimmed">
                          {r.contact.email}
                        </Text>
                      </>
                    ) : (
                      <Text fz="sm" c="dimmed">
                        {r.inviteEmail ?? '—'}
                      </Text>
                    )}
                  </TableTd>
                  <TableTd>
                    <Badge variant="light" color={STATE[r.state].color}>
                      {STATE[r.state].label}
                    </Badge>
                    <Text fz="xs" c="dimmed" mt={2}>
                      {r.state === 'joined' ? (r.lastLoginAt ? `Last seen ${day(r.lastLoginAt)}` : 'Not signed in yet') : r.state === 'invited' && r.inviteSentAt ? `Sent ${day(r.inviteSentAt)}` : ''}
                    </Text>
                  </TableTd>
                  <TableTd>
                    {p.required ? (
                      <>
                        <Group justify="space-between" gap={4} mb={4}>
                          <Text fz="xs">
                            {p.requiredDone} of {p.required} done
                          </Text>
                          {p.nextDeadline ? (
                            <Text fz="xs" c="dimmed">
                              next {day(p.nextDeadline)}
                            </Text>
                          ) : null}
                        </Group>
                        <Progress value={pctDone} size="sm" color={p.overdue ? 'red' : pctDone === 100 ? 'green' : 'blue'} aria-label={`${pctDone}% of required tasks done`} />
                      </>
                    ) : (
                      <Text fz="xs" c="dimmed">
                        No required tasks
                      </Text>
                    )}
                    {p.overdue || p.awaitingReview || p.changesNeeded ? (
                      <Group gap={4} mt={4}>
                        {p.overdue ? (
                          <Badge size="xs" color="red" variant="light">
                            {p.overdue} overdue
                          </Badge>
                        ) : null}
                        {p.awaitingReview ? (
                          <Badge size="xs" color="blue" variant="light">
                            {p.awaitingReview} to review
                          </Badge>
                        ) : null}
                        {p.changesNeeded ? (
                          <Badge size="xs" color="orange" variant="light">
                            {p.changesNeeded} with changes asked
                          </Badge>
                        ) : null}
                      </Group>
                    ) : null}
                  </TableTd>
                  {canSeeOrders ? (
                    <TableTd>
                      {r.spend.orders ? (
                        <>
                          <Text fz="sm">{pounds(r.spend.paidPence + r.spend.unpaidPence)}</Text>
                          <Text fz="xs" c="dimmed">
                            {r.spend.orders} {r.spend.orders === 1 ? 'order' : 'orders'}
                          </Text>
                          {r.spend.unpaidPence ? (
                            <Text fz="xs" c="orange">
                              {pounds(r.spend.unpaidPence)} unpaid
                            </Text>
                          ) : null}
                        </>
                      ) : (
                        <Text fz="xs" c="dimmed">
                          None
                        </Text>
                      )}
                    </TableTd>
                  ) : null}
                </TableTr>
              );
            })}
          </TableTbody>
        </Table>
        </TableScrollContainer>
      </Paper>
    </Stack>
  );
}
