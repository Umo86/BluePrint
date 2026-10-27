import { Accordion, AccordionControl, AccordionItem, AccordionPanel, Alert, Badge, Group, List, ListItem, Paper, SimpleGrid, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, Title } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { TextLink } from '@/components/links';
import { requireSuperAdmin } from '@/server/auth/current';
import { demoOverview } from '@/server/demo/remove';
import { storageMode } from '@/server/env';
import { dateTime } from '@/lib/format';
import { RemoveDemo, ResetDemo } from './demo-controls';

// Adding a fresh copy of the demo data takes a little while.
export const maxDuration = 300;

const STATUS_LABEL: Record<string, string> = { draft: 'Draft', live: 'Live', onsite: 'On site', closed: 'Closed', archived: 'Archived' };

export default async function DemoDataPage() {
  const actor = await requireSuperAdmin();
  const { state, plan } = await demoOverview(actor);
  const loaded = !plan.empty;
  const removed = !loaded && Boolean(state?.removedAt);
  const c = plan.counts;

  return (
    <Stack>
      <PageHeader
        title="Demo data"
        description="An invented organiser with its shows, exhibitors, suppliers and people, for trying BluePrint out as every kind of account. Remove it before you start using BluePrint for real."
        actions={
          <Badge size="lg" variant="light" color={loaded ? 'grape' : 'gray'}>
            {loaded ? 'Demo data is on this site' : removed ? 'Removed' : 'No demo data'}
          </Badge>
        }
      />

      {removed ? (
        <Alert color="green" title="The demo data has been removed" role="status">
          <Stack gap={6}>
            <Text fz="sm">
              Removed {dateTime(state!.removedAt!)} by {state!.removedBy}. It will not be added again when the site is next deployed.
            </Text>
            <Text fz="sm" fw={600}>
              Before you start using BluePrint for real:
            </Text>
            <List fz="sm" spacing={2}>
              <ListItem>In Vercel, under Settings and then Environment Variables, delete DEMO_DATA, TEST_LOGINS, TEST_LOGIN_EMAIL and TEST_LOGIN_PASSWORD, and TWO_FACTOR if it is set to off. Then redeploy.</ListItem>
              <ListItem>Make sure you have a super admin account with your own email address and password. Test accounts shown on the sign-in page should not be used once BluePrint is live.</ListItem>
            </List>
          </Stack>
        </Alert>
      ) : null}

      {loaded ? (
        <>
          <SimpleGrid cols={{ base: 2, md: 5 }}>
            <StatCard label="Shows" value={c.editions} hint={`${c.stands} stands`} />
            <StatCard label="Companies" value={c.companies} />
            <StatCard label="People" value={c.people} />
            <StatCard label="Orders" value={c.orders} />
            <StatCard label="Help desk questions" value={c.questions} hint={`${c.files} files`} />
          </SimpleGrid>

          <Paper withBorder p="md">
            <Title order={2} fz="md" mb="xs">
              The demo shows
            </Title>
            <Table verticalSpacing="xs">
              <TableThead>
                <TableTr>
                  <TableTh>Show</TableTh>
                  <TableTh>Status</TableTh>
                </TableTr>
              </TableThead>
              <TableTbody>
                {plan.shows.flatMap((s) =>
                  s.editions.map((e) => (
                    <TableTr key={e.id}>
                      <TableTd>
                        <TextLink href={`/manage/${e.id}`} fz="sm" fw={600}>
                          {e.name}
                        </TextLink>
                      </TableTd>
                      <TableTd>
                        <Badge variant="light" color={e.status === 'live' ? 'green' : 'gray'}>
                          {STATUS_LABEL[e.status] ?? e.status}
                        </Badge>
                      </TableTd>
                    </TableTr>
                  )),
                )}
              </TableTbody>
            </Table>
          </Paper>

          <Paper withBorder p="md">
            <Title order={2} fz="md" mb="xs">
              How the demo is kept apart
            </Title>
            <List fz="sm" spacing={4}>
              <ListItem>Card payments in the demo shows are practice payments, and so are the demo suppliers’ payouts: no money ever moves, even once Stripe is connected.</ListItem>
              <ListItem>
                Orders, invoices, credit notes and help desk questions in the demo shows are numbered separately (DEMO-ORD-000001 and so on), so your real numbering starts clean.
              </ListItem>
              <ListItem>
                The demo shows never send email, and nothing is sent to an address ending .test, because anyone can use the test logins. Each email is kept in the show’s sent emails; one to a .test address keeps its invitation link, so you can accept invitations from there.
              </ListItem>
              {storageMode() === 'off' ? (
                <ListItem>File storage is not connected yet, so files in the demo shows are kept in the database instead (up to 4 MB each). Real shows can upload files once storage is connected.</ListItem>
              ) : null}
            </List>
          </Paper>

          <Paper withBorder p="md">
            <Title order={2} fz="md" mb="xs">
              What removing it deletes, and what stays
            </Title>
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
              <div>
                <Text fz="sm" fw={600} mb={4}>
                  Deleted
                </Text>
                <Accordion variant="separated" chevronPosition="right">
                  <AccordionItem value="shows">
                    <AccordionControl>
                      <Text fz="sm">
                        {c.shows} shows with everything in them: stands, orders, invoices, forms, stand packs, questions, emails and files
                      </Text>
                    </AccordionControl>
                    <AccordionPanel>
                      <Text fz="sm">{plan.shows.map((s) => s.name).join(', ')}</Text>
                    </AccordionPanel>
                  </AccordionItem>
                  <AccordionItem value="companies">
                    <AccordionControl>
                      <Text fz="sm">{plan.companies.length} companies</Text>
                    </AccordionControl>
                    <AccordionPanel>
                      <Text fz="sm">{plan.companies.map((x) => x.name).join(', ') || 'None'}</Text>
                    </AccordionPanel>
                  </AccordionItem>
                  <AccordionItem value="people">
                    <AccordionControl>
                      <Text fz="sm">{plan.people.length} people and their sign-ins</Text>
                    </AccordionControl>
                    <AccordionPanel>
                      <Stack gap={2}>
                        {plan.people.map((p) => (
                          <Text key={p.id} fz="sm">
                            {p.name || p.email} <Text span c="dimmed" fz="xs">{p.email}{p.why !== 'Demo account' ? ` (${p.why.toLowerCase()})` : ''}</Text>
                          </Text>
                        ))}
                      </Stack>
                    </AccordionPanel>
                  </AccordionItem>
                  <AccordionItem value="suppliers">
                    <AccordionControl>
                      <Text fz="sm">
                        {plan.suppliers.length} suppliers{plan.library.length ? ` and ${plan.library.length} library templates` : ''}
                      </Text>
                    </AccordionControl>
                    <AccordionPanel>
                      <Text fz="sm">{[...plan.suppliers.map((x) => x.name), ...plan.library.map((x) => `${x.name} (library)`)].join(', ') || 'None'}</Text>
                    </AccordionPanel>
                  </AccordionItem>
                </Accordion>
                <Text fz="xs" c="dimmed" mt="xs">
                  The audit log entries for the demo activity go too, so the log starts clean. Removing the demo data is itself recorded.
                </Text>
              </div>
              <div>
                <Text fz="sm" fw={600} mb={4}>
                  Kept
                </Text>
                <List fz="sm" spacing={4}>
                  <ListItem>
                    Your own shows:{' '}
                    {plan.kept.shows.length ? (
                      plan.kept.shows.map((s, i) => (
                        <span key={s.id}>
                          {i ? ', ' : ''}
                          {s.name}
                        </span>
                      ))
                    ) : (
                      <Text span c="dimmed" fz="sm">
                        none yet
                      </Text>
                    )}
                  </ListItem>
                  <ListItem>
                    Every super admin account
                    {plan.kept.superAdmins.length ? `, including ${plan.kept.superAdmins.map((u) => u.email).join(', ')}` : ''}
                  </ListItem>
                  {plan.kept.suppliers.map((s) => (
                    <ListItem key={s.id}>{s.name}: a real show uses this supplier</ListItem>
                  ))}
                  {plan.kept.companies.map((x) => (
                    <ListItem key={x.id}>{x.name}: it has a stand in a real show</ListItem>
                  ))}
                  <ListItem>Platform settings, email templates and everything else outside the demo shows</ListItem>
                </List>
              </div>
            </SimpleGrid>
          </Paper>

          <ResetDemo mode="loaded" />
          <RemoveDemo />
        </>
      ) : (
        <>
          {!removed ? (
            <Paper withBorder p="md">
              <Text fz="sm">There is no demo data on this site.</Text>
            </Paper>
          ) : null}
          <ResetDemo mode={removed ? 'removed' : 'none'} />
        </>
      )}

      {state?.loadedAt && loaded ? (
        <Group>
          <Text fz="xs" c="dimmed">
            Added {dateTime(state.loadedAt)} (version {state.version}).
          </Text>
        </Group>
      ) : null}
    </Stack>
  );
}
