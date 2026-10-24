import { Alert, Badge, Group, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { ButtonLink } from '@/components/links';
import { supplierOverview } from '@/server/services/supplier-portal';
import { money } from '@/lib/format';
import { loadSupplier } from './load';
import { StripeButtons } from './stripe-buttons';

export default async function SupplierOverview({ params }: PageProps<'/supplier/[supplierId]'>) {
  const { supplierId } = await params;
  const { actor, editable } = await loadSupplier(supplierId);
  const o = await supplierOverview(actor, supplierId);
  const base = `/supplier/${supplierId}`;
  const stripe = o.supplier.stripe;
  const byEdition = new Map<string, { name: string; categories: string[] }>();
  for (const c of o.categories) {
    const e = byEdition.get(c.edition.id) ?? { name: c.edition.name, categories: [] };
    e.categories.push(c.category.name);
    byEdition.set(c.edition.id, e);
  }
  return (
    <Stack>
      <PageHeader title={o.supplier.name} description="Orders from exhibitors for the services you supply, your catalogue and your payouts." />
      {o.supplier.status !== 'active' ? <Alert color="red">This supplier account is switched off. Contact the show team.</Alert> : null}
      {o.paymentsMode && !stripe.payoutsEnabled ? (
        <Alert color="yellow" title="Set up payouts">
          <Stack gap="xs">
            <Text fz="sm">Exhibitors pay Media10 by card, and your share is sent to your bank account through Stripe. Until you finish setting up, your payouts wait for you.</Text>
            <StripeButtons supplierId={supplierId} connected={stripe.connected} ready={stripe.payoutsEnabled} editable={editable} />
          </Stack>
        </Alert>
      ) : null}
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <StatCard label="New orders" value={o.counts.newLines} hint="Waiting for you to confirm" color={o.counts.newLines ? 'blue' : undefined} />
        <StatCard label="Confirmed" value={o.counts.confirmed} hint={`${o.counts.delivered} delivered`} />
        <StatCard label="Paid out" value={money(o.money.paidOutPence)} hint={o.money.waitingPence ? `${money(o.money.waitingPence)} waiting` : o.money.manualOwedPence ? `${money(o.money.manualOwedPence)} to come by bank transfer` : 'Nothing waiting'} />
      </SimpleGrid>
      <Group>
        <ButtonLink href={`${base}/orders`}>See orders</ButtonLink>
        <ButtonLink href={`${base}/catalogue`} variant="default">
          Your catalogue
        </ButtonLink>
      </Group>
      <Paper withBorder p="md">
        <Title order={2} fz="md" mb="xs">
          Shows you supply
        </Title>
        {byEdition.size ? (
          <Stack gap="xs">
            {[...byEdition.values()].map((e) => (
              <Group key={e.name} gap="xs">
                <Text fz="sm" fw={600}>
                  {e.name}
                </Text>
                {e.categories.map((c) => (
                  <Badge key={c} variant="light" size="sm">
                    {c}
                  </Badge>
                ))}
              </Group>
            ))}
          </Stack>
        ) : (
          <Text fz="sm" c="dimmed">
            The show team has not assigned you to a show yet.
          </Text>
        )}
      </Paper>
    </Stack>
  );
}
