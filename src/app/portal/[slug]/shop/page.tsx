import { Alert, Badge, Card, CardSection, Group, Image, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconShoppingCart } from '@tabler/icons-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { ButtonLink } from '@/components/links';
import { shopForStand } from '@/server/services/shop';
import { dateLong, money } from '@/lib/format';
import { loadPortal } from '../load';
import { AddToBasketButton } from './shop-client';

export default async function ShopPage({ params }: PageProps<'/portal/[slug]/shop'>) {
  const { slug } = await params;
  const ctx = await loadPortal(slug);
  const shop = await shopForStand(ctx.actor, ctx.stand.id);
  const base = `/portal/${ctx.edition.slug}`;
  const tz = ctx.edition.timezone;
  return (
    <Stack>
      <PageHeader
        title="Order services"
        description={`Furniture, electrics, cleaning and more for stand ${ctx.stand.number}. Prices are shown before VAT; VAT is added at checkout.`}
        actions={
          <ButtonLink href={`${base}/shop/basket`} leftSection={<IconShoppingCart size={16} />} variant={shop.basketCount ? 'filled' : 'default'}>
            Basket{shop.basketCount ? ` (${shop.basketCount})` : ''}
          </ButtonLink>
        }
      />
      {ctx.closedReason ? <Alert color="gray">{ctx.closedReason}</Alert> : null}
      {shop.categories.length ? (
        shop.categories.map((c) => (
          <Stack key={c.id} gap="sm">
            <div>
              <Group gap="sm">
                <Title order={2} fz="lg">
                  {c.name}
                </Title>
                {c.orderBy ? (
                  <Badge variant="light" color={c.orderBy < new Date() ? 'orange' : 'blue'}>
                    {c.orderBy < new Date() ? 'Order deadline passed' : `Order by ${dateLong(c.orderBy, tz)}`}
                  </Badge>
                ) : null}
              </Group>
              {c.description ? (
                <Text fz="sm" c="dimmed" maw={760}>
                  {c.description}
                </Text>
              ) : null}
            </div>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
              {c.products.map((p) => (
                <Card key={p.id} withBorder padding="md" radius="md">
                  {p.imageUrl ? (
                    <CardSection>
                      <Image src={p.imageUrl} alt="" h={160} fit="contain" bg="gray.0" />
                    </CardSection>
                  ) : null}
                  <Stack gap={6} mt={p.imageUrl ? 'sm' : 0} style={{ flex: 1 }}>
                    <Text fw={600}>{p.name}</Text>
                    {p.supplierName ? (
                      <Text fz="xs" c="dimmed">
                        Supplied by {p.supplierName}
                      </Text>
                    ) : null}
                    {p.description ? (
                      <Text fz="sm" c="dimmed" lineClamp={4} style={{ whiteSpace: 'pre-line' }}>
                        {p.description}
                      </Text>
                    ) : null}
                  </Stack>
                  <Group justify="space-between" mt="md" align="flex-end">
                    <div>
                      <Text fw={700}>
                        {money(p.unitPence)}
                        <Text span fz="xs" c="dimmed" fw={400}>
                          {' '}
                          + VAT{p.unit !== 'each' ? ` ${p.unit}` : ''}
                        </Text>
                      </Text>
                      {p.band === 'early' && p.bandUntil ? (
                        <Text fz="xs" c="green">
                          Early-bird price until {dateLong(p.bandUntil, tz)}
                          {p.standardPence !== p.unitPence ? ` (then ${money(p.standardPence)})` : ''}
                        </Text>
                      ) : p.band === 'late' ? (
                        <Text fz="xs" c="orange">
                          Late-order price
                        </Text>
                      ) : p.latePence !== null && p.lateFrom ? (
                        <Text fz="xs" c="dimmed">
                          {money(p.latePence)} from {dateLong(p.lateFrom, tz)}
                        </Text>
                      ) : null}
                      {p.stockLeft !== null && p.stockLeft <= 10 ? (
                        <Text fz="xs" c={p.stockLeft ? 'orange' : 'red'}>
                          {p.stockLeft ? `Only ${p.stockLeft} left` : 'Sold out'}
                        </Text>
                      ) : null}
                    </div>
                    <AddToBasketButton slug={ctx.edition.slug} standId={ctx.stand.id} product={p} disabled={!ctx.editable} />
                  </Group>
                </Card>
              ))}
            </SimpleGrid>
          </Stack>
        ))
      ) : (
        <EmptyState title="Nothing to order yet" description="The show team has not added any services for your stand type yet. Check back soon." />
      )}
    </Stack>
  );
}
