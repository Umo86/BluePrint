import { List, ListItem, Paper, Stack, Text, Title } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { TextLink } from '@/components/links';
import { requireSuperAdmin } from '@/server/auth/current';
import { getPlatformSettings } from '@/server/services/settings';
import { PrivacyLookup } from './privacy-lookup';

export default async function GdprPage() {
  await requireSuperAdmin();
  const settings = await getPlatformSettings();
  const r = settings.retention;
  return (
    <Stack>
      <PageHeader
        title="Privacy (GDPR)"
        description="Handle subject access and erasure requests. Every lookup, download and erasure is recorded in the audit log."
      />
      <PrivacyLookup />
      <Paper withBorder p="md">
        <Title order={2} fz="md" mb="xs">
          How long BluePrint keeps records
        </Title>
        <List size="sm" spacing={4}>
          <ListItem>Orders, invoices and refunds: {r.ordersYears} years (UK tax law).</ListItem>
          <ListItem>Space-only packs and approvals: {r.spaceOnlyYearsAfterShow} years after the show (health and safety).</ListItem>
          <ListItem>Incident reports: {r.incidentYears} years.</ListItem>
          <ListItem>Contacts with no activity: {r.inactiveContactYears} years, then anonymised.</ListItem>
          <ListItem>Email logs: {r.emailLogMonths} months.</ListItem>
        </List>
        <Text fz="sm" mt="xs">
          Change these in <TextLink href="/admin/settings">platform settings</TextLink>.
        </Text>
      </Paper>
      <Paper withBorder p="md">
        <Title order={2} fz="md" mb="xs">
          Handling a request
        </Title>
        <List size="sm" spacing={4} type="ordered">
          <ListItem>Check the person is who they say they are, for example by replying to the address on record.</ListItem>
          <ListItem>Look them up above. A subject access request is answered with the data download within one month.</ListItem>
          <ListItem>For erasure, financial and health and safety records are kept (the law requires them) but are no longer linked to their name.</ListItem>
          <ListItem>Note the request and what you did in your privacy log.</ListItem>
        </List>
      </Paper>
    </Stack>
  );
}
