import { Alert, Badge, Group, Paper, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { LinkTabs } from '@/components/ui/link-tabs';
import { PageNav, SearchFilter } from '@/components/ui/list-controls';
import { ActionButton } from '@/components/action-button';
import { ButtonLink, TextLink } from '@/components/links';
import { LOG_FILTERS, emailLog, listTemplates } from '@/server/services/email-admin';
import { listCampaigns } from '@/server/services/campaigns';
import { dateTime } from '@/lib/format';
import { cancelCampaignAction } from '../../email-actions';
import { loadEdition } from '../load';

const CAMPAIGN_STATUS: Record<string, string> = { draft: 'Draft', scheduled: 'Scheduled', sending: 'Sending', sent: 'Sent', cancelled: 'Cancelled' };
const LOG_LABELS: Record<(typeof LOG_FILTERS)[number], string> = {
  all: 'All emails',
  problems: 'Bounced or not sent',
  campaign: 'Show updates',
  reminder: 'Reminders',
  transactional: 'Service emails',
};

export default async function EmailsPage({ params, searchParams }: PageProps<'/manage/[editionId]/emails'>) {
  const { editionId } = await params;
  const sp = await searchParams;
  const { actor, edition } = await loadEdition(editionId, 'send_emails');
  const tab = sp.tab === 'campaigns' ? 'campaigns' : sp.tab === 'sent' ? 'sent' : 'templates';
  const base = `/manage/${edition.id}/emails`;
  const tz = edition.timezone;
  const sender = edition.emailSettings.senderAddress;
  return (
    <Stack>
      <PageHeader
        title="Emails"
        description="The emails BluePrint sends for this show: standard emails you can reword, updates you send to groups of exhibitors, and a record of everything sent."
        actions={tab === 'campaigns' ? <ButtonLink href={`${base}/campaigns/new`}>New email to exhibitors</ButtonLink> : null}
      />
      {!sender ? (
        <Alert color="yellow">
          This show has no sender address yet, so emails go from the platform default. Set it in <TextLink href={`/manage/${edition.id}/settings`}>Show settings</TextLink> once the sending domain is verified in Resend.
        </Alert>
      ) : null}
      <LinkTabs
        value={tab}
        tabs={[
          { value: 'templates', label: 'Standard emails', href: base },
          { value: 'campaigns', label: 'Updates to exhibitors', href: `${base}?tab=campaigns` },
          { value: 'sent', label: 'Sent', href: `${base}?tab=sent` },
        ]}
      />
      {tab === 'templates' ? <Templates editionId={edition.id} actor={actor} /> : null}
      {tab === 'campaigns' ? (
        <>
          {sp.sent ? <Alert color="green">Sending now. Progress shows under “Sent”.</Alert> : null}
          {sp.scheduled ? <Alert color="green">Scheduled. It will go at the time you chose.</Alert> : null}
          <Campaigns editionId={edition.id} actor={actor} tz={tz} />
        </>
      ) : null}
      {tab === 'sent' ? <Sent editionId={edition.id} actor={actor} tz={tz} sp={sp} /> : null}
    </Stack>
  );
}

async function Templates({ editionId, actor }: { editionId: string; actor: Awaited<ReturnType<typeof loadEdition>>['actor'] }) {
  const rows = await listTemplates(actor, editionId);
  return (
    <Paper withBorder>
      <Table verticalSpacing="sm">
        <TableThead>
          <TableTr>
            <TableTh>Email</TableTh>
            <TableTh>Subject</TableTh>
            <TableTh>Wording</TableTh>
          </TableTr>
        </TableThead>
        <TableTbody>
          {rows.map((t) => (
            <TableTr key={t.key}>
              <TableTd>
                <TextLink href={`/manage/${editionId}/emails/templates/${t.key}`} fw={600} fz="sm">
                  {t.name}
                </TextLink>
                <Text fz="xs" c="dimmed">
                  {t.description}
                </Text>
              </TableTd>
              <TableTd>
                <Text fz="sm">{t.subject}</Text>
              </TableTd>
              <TableTd>{t.custom ? <Badge color="blue" variant="light">Your own</Badge> : <Badge color="gray" variant="light">Standard</Badge>}</TableTd>
            </TableTr>
          ))}
        </TableTbody>
      </Table>
      <Text fz="xs" c="dimmed" p="md">
        Sign-in codes and security emails always use fixed wording, so they cannot be imitated.
      </Text>
    </Paper>
  );
}

async function Campaigns({ editionId, actor, tz }: { editionId: string; actor: Awaited<ReturnType<typeof loadEdition>>['actor']; tz: string }) {
  const rows = await listCampaigns(actor, editionId);
  if (!rows.length) return <EmptyState title="No updates yet" description="Send an update to all exhibitors, or a group such as space-only stands that have not ordered electrics." />;
  return (
    <Paper withBorder>
      <Table verticalSpacing="sm">
        <TableThead>
          <TableTr>
            <TableTh>Email</TableTh>
            <TableTh>Status</TableTh>
            <TableTh>Recipients</TableTh>
            <TableTh />
          </TableTr>
        </TableThead>
        <TableTbody>
          {rows.map((c) => (
            <TableTr key={c.id}>
              <TableTd>
                <TextLink href={`/manage/${editionId}/emails/campaigns/${c.id}`} fw={600} fz="sm">
                  {c.name}
                </TextLink>
                <Text fz="xs" c="dimmed">
                  {c.subject}
                </Text>
              </TableTd>
              <TableTd>
                <StatusBadge status={c.status === 'sending' ? 'running' : c.status} label={CAMPAIGN_STATUS[c.status]} />
                <Text fz="xs" c="dimmed">
                  {c.status === 'scheduled' && c.scheduledFor ? `For ${dateTime(c.scheduledFor, tz)}` : c.sentAt ? dateTime(c.sentAt, tz) : `Created ${dateTime(c.createdAt, tz)}`}
                </Text>
              </TableTd>
              <TableTd>{c.status === 'sent' ? c.recipients : '—'}</TableTd>
              <TableTd>
                {c.status === 'scheduled' ? (
                  <ActionButton action={cancelCampaignAction} args={[c.id]} size="xs" variant="default">
                    Don’t send
                  </ActionButton>
                ) : null}
              </TableTd>
            </TableTr>
          ))}
        </TableTbody>
      </Table>
    </Paper>
  );
}

async function Sent({ editionId, actor, tz, sp }: { editionId: string; actor: Awaited<ReturnType<typeof loadEdition>>['actor']; tz: string; sp: Record<string, string | string[] | undefined> }) {
  const filter = LOG_FILTERS.find((f) => f === sp.filter) ?? 'all';
  const page = Number.parseInt(typeof sp.page === 'string' ? sp.page : '1', 10) || 1;
  const q = typeof sp.q === 'string' ? sp.q : '';
  const log = await emailLog(actor, editionId, { filter, q, page });
  return (
    <Stack>
      <Group>
        <SearchFilter placeholder="Email address or subject" filterOptions={LOG_FILTERS.map((f) => ({ value: f, label: LOG_LABELS[f] }))} filterLabel="Show" />
      </Group>
      <Paper withBorder>
        <Table verticalSpacing="xs">
          <TableThead>
            <TableTr>
              <TableTh>Sent</TableTh>
              <TableTh>To</TableTh>
              <TableTh>Subject</TableTh>
              <TableTh>Status</TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {log.rows.map((m) => (
              <TableTr key={m.id}>
                <TableTd>
                  <Text fz="xs">{dateTime(m.createdAt, tz)}</Text>
                </TableTd>
                <TableTd>
                  <Text fz="sm">{m.toEmail}</Text>
                </TableTd>
                <TableTd>
                  <TextLink href={`/manage/${editionId}/emails/sent/${m.id}`} fz="sm">
                    {m.subject}
                  </TextLink>
                </TableTd>
                <TableTd>
                  <StatusBadge status={m.status} />
                  {m.error ? (
                    <Text fz="xs" c="dimmed">
                      {m.error}
                    </Text>
                  ) : null}
                </TableTd>
              </TableTr>
            ))}
          </TableTbody>
        </Table>
      </Paper>
      <PageNav total={log.total} page={log.page} pageSize={log.pageSize} />
    </Stack>
  );
}
