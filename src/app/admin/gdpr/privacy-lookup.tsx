'use client';

import { useState } from 'react';
import { Alert, Button, Group, Paper, Stack, Table, TableTbody, TableTd, TableTh, TableTr, Text, TextInput, Title } from '@mantine/core';
import { useAction } from '@/lib/use-action';
import { ActionButton } from '@/components/action-button';
import { DownloadButton, TextLink } from '@/components/links';
import { eraseAddressAction, lookupPersonAction, type PersonLookup } from '../actions';

const COUNT_LABELS: Record<string, string> = {
  emails: 'Emails sent to them',
  invitations: 'Invitations',
  contractorContacts: 'Contractor nominations',
  helpDeskContacts: 'Help desk contact details',
  unsubscribes: 'Unsubscribes',
  suppressions: 'Blocked address entries',
};

export function PrivacyLookup() {
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<PersonLookup | null>(null);
  const lookup = useAction(lookupPersonAction, { onSuccess: (data) => setResult(data ?? null) });
  return (
    <Paper withBorder p="md">
      <Title order={2} fz="md" mb="sm">
        Find a person
      </Title>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          lookup.run(email);
        }}
      >
        <Group align="flex-end" gap="xs">
          <TextInput label="Email address" type="email" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} w={340} autoComplete="off" />
          <Button type="submit" loading={lookup.pending}>
            Look up
          </Button>
        </Group>
      </form>
      {result ? (
        <Stack mt="md">
          {result.user ? (
            <Alert color={result.user.anonymised ? 'gray' : 'blue'} variant="light" title={result.user.anonymised ? 'Already erased' : 'BluePrint account found'}>
              <Stack gap="xs">
                <Text fz="sm">
                  {result.user.name || result.email} · account created {result.user.createdAt}
                </Text>
                {!result.user.anonymised ? (
                  <Group gap="xs">
                    <DownloadButton href={`/admin/gdpr/export/${result.user.id}`} size="xs" variant="default">
                      Download their data (JSON)
                    </DownloadButton>
                    <TextLink href={`/admin/users/${result.user.id}`} fz="sm">
                      Open the account to erase it
                    </TextLink>
                  </Group>
                ) : null}
              </Stack>
            </Alert>
          ) : (
            <Alert color="gray" variant="light" title="No BluePrint account with this address">
              <Text fz="sm">Their address may still appear in other records.</Text>
            </Alert>
          )}
          <Table variant="vertical" w={460}>
            <TableTbody>
              {Object.entries(result.counts).map(([k, n]) => (
                <TableTr key={k}>
                  <TableTh w={260}>{COUNT_LABELS[k] ?? k}</TableTh>
                  <TableTd>{n}</TableTd>
                </TableTr>
              ))}
            </TableTbody>
          </Table>
          {!result.user && Object.values(result.counts).some((n) => n > 0) ? (
            <Group>
              <ActionButton
                action={eraseAddressAction}
                args={[result.email]}
                color="red"
                variant="light"
                size="xs"
                refresh={false}
                confirm={{
                  title: `Erase ${result.email}?`,
                  body: 'The address is removed from emails, invitations, contractor nominations and help desk tickets. This cannot be undone.',
                  typeToConfirm: result.email,
                  confirmLabel: 'Erase for good',
                  danger: true,
                }}
              >
                Erase this address everywhere
              </ActionButton>
            </Group>
          ) : null}
        </Stack>
      ) : null}
    </Paper>
  );
}
