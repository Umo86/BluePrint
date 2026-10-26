import { Badge, Group, Paper, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { PageHeader } from '@/components/ui/page-header';
import { SearchFilter } from '@/components/ui/list-controls';
import { LinkTabs } from '@/components/ui/link-tabs';
import { DownloadButton, TextLink } from '@/components/links';
import { describeLineDetails, servicesForEdition, totalsByProduct } from '@/server/services/service-lists';
import { FULFILMENT_LABELS } from '@/server/services/orders';
import { shopCategoriesForFilters } from '@/server/services/catalogue';
import { standsWithoutOrderFrom } from '@/server/services/stands';
import { loadEdition } from '../../load';

const FULFILMENT_COLORS = { received: 'gray', confirmed: 'blue', delivered: 'green', cancelled: 'red' } as const;

export default async function ServicesByStand({ params, searchParams }: PageProps<'/manage/[editionId]/orders/services'>) {
  const { editionId } = await params;
  const sp = await searchParams;
  const { actor, edition } = await loadEdition(editionId, 'orders');
  const tab = sp.tab === 'products' ? 'products' : 'stands';
  const q = (typeof sp.q === 'string' ? sp.q : '').trim().toLowerCase().slice(0, 100);
  const supplier = typeof sp.filter === 'string' ? sp.filter : 'all';
  const { lines } = await servicesForEdition(actor, edition.id);
  const categories = await shopCategoriesForFilters(actor, edition.id);
  const notOrdered = await Promise.all(categories.map(async (c) => ({ ...c, stands: (await standsWithoutOrderFrom(edition.id, c.id)).size })));
  const supplierNames = [...new Set(lines.map((l) => l.supplierName ?? 'Organiser'))].sort((a, b) => a.localeCompare(b, 'en-GB'));
  const shown = lines.filter(
    (l) =>
      (supplier === 'all' || (l.supplierName ?? 'Organiser') === supplier) &&
      (!q || [l.standNumber, l.companyName ?? '', l.line.description, l.hallName ?? ''].some((v) => v.toLowerCase().includes(q))),
  );
  const products = totalsByProduct(shown);
  const base = `/manage/${edition.id}`;
  const keep = new URLSearchParams();
  if (q) keep.set('q', q);
  if (supplier !== 'all') keep.set('filter', supplier);
  const tabHref = (t: string) => {
    const u = new URLSearchParams(keep);
    if (t !== 'stands') u.set('tab', t);
    return `${base}/orders/services${u.size ? `?${u}` : ''}`;
  };
  // Group the delivery list by hall, then stand.
  const groups = new Map<string, typeof shown>();
  for (const l of shown) {
    const key = `${l.hallName ?? 'No hall'}|${l.standNumber}|${l.companyName ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  return (
    <Stack>
      <TextLink href={`${base}/orders`} fz="sm">
        ← Orders
      </TextLink>
      <PageHeader
        title="Services by stand"
        description="What each stand has ordered and paid for (or is paying by invoice), for delivery during build-up. Cancelled and refunded items are left out."
        actions={
          <DownloadButton href={`${base}/reports/services`} variant="default" leftSection={<IconDownload size={16} />}>
            Download (Excel)
          </DownloadButton>
        }
      />
      {notOrdered.length ? (
        <Paper withBorder p="md">
          <Text fz="sm" fw={600} mb={6}>
            Who has not ordered yet
          </Text>
          <Group gap="xs">
            {notOrdered.map((c) => (
              <TextLink key={c.id} href={`${base}/exhibitors?notOrdered=${c.id}`} fz="sm">
                <Badge variant="light" color={c.stands ? 'orange' : 'green'} style={{ cursor: 'pointer', textTransform: 'none' }}>
                  {c.name}: {c.stands} {c.stands === 1 ? 'stand' : 'stands'}
                </Badge>
              </TextLink>
            ))}
          </Group>
          <Text fz="xs" c="dimmed" mt={6}>
            Opens the exhibitors list for those stands, where you can email them.
          </Text>
        </Paper>
      ) : null}
      <LinkTabs
        value={tab}
        tabs={[
          { value: 'stands', label: 'By stand', href: tabHref('stands') },
          { value: 'products', label: 'By product', href: tabHref('products') },
        ]}
      />
      <SearchFilter placeholder="Stand, company, hall or item" filterOptions={[{ value: 'all', label: 'Every supplier' }, ...supplierNames.map((n) => ({ value: n, label: n }))]} filterLabel="Supplier" />
      {tab === 'stands' ? (
        <Paper withBorder>
          <Table verticalSpacing="xs">
            <TableThead>
              <TableTr>
                <TableTh w={170}>Stand</TableTh>
                <TableTh>Item</TableTh>
                <TableTh w={60} ta="right">
                  Qty
                </TableTh>
                <TableTh>Supplier</TableTh>
                <TableTh w={140}>Status</TableTh>
              </TableTr>
            </TableThead>
            <TableTbody>
              {[...groups.entries()].map(([key, items]) =>
                items.map((l, i) => (
                  <TableTr key={l.line.id}>
                    {i === 0 ? (
                      <TableTd rowSpan={items.length} style={{ verticalAlign: 'top' }}>
                        <Text fz="sm" fw={700}>
                          {l.standNumber}
                        </Text>
                        <Text fz="xs" c="dimmed">
                          {[l.hallName, l.companyName].filter(Boolean).join(' · ') || key}
                        </Text>
                      </TableTd>
                    ) : null}
                    <TableTd>
                      <TextLink href={`${base}/orders/${l.order.id}`} fz="sm">
                        {l.line.description}
                      </TextLink>
                      {describeLineDetails(l.line) ? (
                        <Text fz="xs" c="dimmed">
                          {describeLineDetails(l.line)}
                        </Text>
                      ) : null}
                    </TableTd>
                    <TableTd ta="right">
                      <Text fz="sm">{l.line.quantity}</Text>
                    </TableTd>
                    <TableTd>
                      <Text fz="sm">{l.supplierName ?? 'Organiser'}</Text>
                    </TableTd>
                    <TableTd>
                      <Badge variant="light" color={FULFILMENT_COLORS[l.line.fulfilmentStatus]}>
                        {FULFILMENT_LABELS[l.line.fulfilmentStatus]}
                      </Badge>
                    </TableTd>
                  </TableTr>
                )),
              )}
            </TableTbody>
          </Table>
          {shown.length === 0 ? (
            <Text p="md" c="dimmed" fz="sm">
              {lines.length ? 'Nothing matches.' : 'Nothing has been ordered yet.'}
            </Text>
          ) : null}
        </Paper>
      ) : (
        <Paper withBorder>
          <Table verticalSpacing="xs">
            <TableThead>
              <TableTr>
                <TableTh>Item</TableTh>
                <TableTh>Supplier</TableTh>
                <TableTh ta="right">Ordered</TableTh>
                <TableTh ta="right">Delivered</TableTh>
                <TableTh>Stands</TableTh>
              </TableTr>
            </TableThead>
            <TableTbody>
              {products.map((p) => (
                <TableTr key={p.key}>
                  <TableTd>
                    <Text fz="sm" fw={600}>
                      {p.item}
                    </Text>
                  </TableTd>
                  <TableTd>
                    <Text fz="sm">{p.supplier}</Text>
                  </TableTd>
                  <TableTd ta="right">
                    <Text fz="sm">{p.quantity}</Text>
                  </TableTd>
                  <TableTd ta="right">
                    <Text fz="sm" c={p.delivered === p.quantity ? 'green' : undefined}>
                      {p.delivered}
                    </Text>
                  </TableTd>
                  <TableTd>
                    <Group gap={4}>
                      {p.stands.map((s) => (
                        <Badge key={s} size="sm" variant="outline" color="gray">
                          {s}
                        </Badge>
                      ))}
                    </Group>
                  </TableTd>
                </TableTr>
              ))}
            </TableTbody>
          </Table>
          {products.length === 0 ? (
            <Text p="md" c="dimmed" fz="sm">
              {lines.length ? 'Nothing matches.' : 'Nothing has been ordered yet.'}
            </Text>
          ) : null}
        </Paper>
      )}
    </Stack>
  );
}
