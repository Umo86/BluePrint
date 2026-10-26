'use client';

import { useMemo, useState } from 'react';
import { Anchor, Badge, Card, CardSection, Group, Image, Select, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { dateLong, money } from '@/lib/format';
import type { ShopProduct } from '@/server/services/shop';
import { AddToBasketButton } from './shop-client';

type Category = { id: string; name: string; description: string | null; orderBy: Date | null; products: ShopProduct[] };
type Sort = 'default' | 'name' | 'price_asc' | 'price_desc';

const SORTS: { value: Sort; label: string }[] = [
  { value: 'default', label: 'Show team’s order' },
  { value: 'name', label: 'Name, A to Z' },
  { value: 'price_asc', label: 'Price, low to high' },
  { value: 'price_desc', label: 'Price, high to low' },
];

/** The shop's categories and products, with search by name or product code, sorting and links to each category. */
export function ShopBrowser({ slug, standId, editable, tz, categories }: { slug: string; standId: string; editable: boolean; tz: string; categories: Category[] }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('default');
  const total = categories.reduce((n, c) => n + c.products.length, 0);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (p: ShopProduct) => !q || [p.name, p.code ?? '', p.description ?? '', p.supplierName ?? ''].some((t) => t.toLowerCase().includes(q));
    const order = (list: ShopProduct[]) => {
      if (sort === 'name') return [...list].sort((a, b) => a.name.localeCompare(b.name));
      if (sort === 'price_asc') return [...list].sort((a, b) => a.unitPence - b.unitPence);
      if (sort === 'price_desc') return [...list].sort((a, b) => b.unitPence - a.unitPence);
      return list;
    };
    return categories.map((c) => ({ ...c, products: order(c.products.filter(match)) })).filter((c) => c.products.length > 0);
  }, [categories, query, sort]);
  const now = new Date();

  return (
    <Stack gap="lg">
      {total >= 6 ? (
        <Group align="flex-end" gap="sm">
          <TextInput
            label="Search"
            placeholder="Name or product code"
            leftSection={<IconSearch size={16} />}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            w={300}
          />
          <Select label="Sort" data={SORTS} value={sort} onChange={(v) => setSort((v as Sort) ?? 'default')} allowDeselect={false} w={220} />
        </Group>
      ) : null}
      {categories.length > 1 && !query ? (
        <Group gap="xs" component="nav" aria-label="Categories">
          {categories.map((c) => (
            <Anchor key={c.id} href={`#category-${c.id}`} fz="sm">
              {c.name} ({c.products.length})
            </Anchor>
          ))}
        </Group>
      ) : null}
      {query && !shown.length ? (
        <Text c="dimmed" role="status">
          Nothing matches “{query.trim()}”. Try another word or a product code.
        </Text>
      ) : null}
      {shown.map((c) => (
        <Stack key={c.id} gap="sm" id={`category-${c.id}`} style={{ scrollMarginTop: 80 }}>
          <div>
            <Group gap="sm">
              <Title order={2} fz="lg">
                {c.name}
              </Title>
              {c.orderBy ? (
                <Badge variant="light" color={c.orderBy < now ? 'orange' : 'blue'}>
                  {c.orderBy < now ? 'Order deadline passed' : `Order by ${dateLong(c.orderBy, tz)}`}
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
                  {p.supplierName || p.code ? (
                    <Text fz="xs" c="dimmed">
                      {[p.supplierName ? `Supplied by ${p.supplierName}` : null, p.code ? `Code ${p.code}` : null].filter(Boolean).join(' · ')}
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
                  <AddToBasketButton slug={slug} standId={standId} product={p} disabled={!editable} />
                </Group>
              </Card>
            ))}
          </SimpleGrid>
        </Stack>
      ))}
    </Stack>
  );
}
