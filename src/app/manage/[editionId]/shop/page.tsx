import { Alert, Badge, Group, Image, Paper, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, Title } from '@mantine/core';
import { LinkTabs } from '@/components/ui/link-tabs';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { ButtonLink, TextLink } from '@/components/links';
import { catalogueForStaff } from '@/server/services/catalogue';
import { payments } from '@/server/payments/provider';
import { commissionLabel, dateLong, money, percentFromBps } from '@/lib/format';
import { loadEdition } from '../load';
import { ApprovalButtons, CategoryButton, CategoryRowActions, ProductRowActions } from './catalogue-controls';

const STATUS_LABELS: Record<string, string> = { draft: 'Draft', pending_approval: 'Awaiting approval', approved: 'On sale', rejected: 'Sent back', archived: 'Off sale' };
const DAY = 86_400_000;

export default async function ShopCatalogue({ params, searchParams }: PageProps<'/manage/[editionId]/shop'>) {
  const { editionId } = await params;
  const sp = await searchParams;
  const tab = sp.tab === 'approval' ? 'approval' : 'catalogue';
  const { actor, edition } = await loadEdition(editionId, 'manage_orders');
  const cat = await catalogueForStaff(actor, edition.id);
  const base = `/manage/${edition.id}/shop`;
  const supplierOptions = cat.suppliers.filter((s) => s.status === 'active').map((s) => ({ value: s.id, label: s.name }));
  const typeOptions = cat.types.map((t) => ({ value: t.id, label: t.name }));
  const typeName = new Map(cat.types.map((t) => [t.id, t.name]));
  const supplierName = new Map(cat.suppliers.map((s) => [s.id, s.name]));
  const pending = cat.products.filter((p) => p.status === 'pending_approval');
  const cardsOn = Boolean(payments());

  return (
    <Stack>
      <PageHeader
        title="Shop catalogue"
        description="The services exhibitors can order: furniture, electrics, AV, cleaning and more. Each category is fulfilled by a supplier (paid through Stripe) or by Media10."
        actions={
          <Group gap="xs">
            <CategoryButton editionId={edition.id} suppliers={supplierOptions} types={typeOptions} canSetCommission={cat.canSetCommission} />
            {cat.categories.length ? <ButtonLink href={`${base}/products/new`}>Add a product</ButtonLink> : null}
          </Group>
        }
      />
      {!cardsOn ? (
        <Alert color="yellow" title="Card payments are not switched on">
          Exhibitors can only order on invoice until Stripe is connected. See the deployment guide.
        </Alert>
      ) : null}
      <LinkTabs
        value={tab}
        tabs={[
          { value: 'catalogue', label: 'Catalogue', href: base },
          { value: 'approval', label: 'Awaiting approval', href: `${base}?tab=approval`, count: pending.length },
        ]}
      />

      {tab === 'approval' ? (
        pending.length ? (
          <Paper withBorder>
            <Table verticalSpacing="sm">
              <TableThead>
                <TableTr>
                  <TableTh>Product</TableTh>
                  <TableTh>Supplier</TableTh>
                  <TableTh>Price</TableTh>
                  <TableTh />
                </TableTr>
              </TableThead>
              <TableTbody>
                {pending.map((p) => (
                  <TableTr key={p.id}>
                    <TableTd>
                      <TextLink href={`${base}/products/${p.id}`} fw={600} fz="sm">
                        {p.name}
                      </TextLink>
                      <Text fz="xs" c="dimmed" lineClamp={2} maw={420}>
                        {p.description}
                      </Text>
                    </TableTd>
                    <TableTd>
                      <Text fz="sm">{p.supplierId ? supplierName.get(p.supplierId) : 'Media10'}</Text>
                    </TableTd>
                    <TableTd>
                      <Text fz="sm">
                        {money(p.pricePence)} + VAT {percentFromBps(p.vatRateBps)}
                      </Text>
                    </TableTd>
                    <TableTd>
                      <ApprovalButtons productId={p.id} name={p.name} />
                    </TableTd>
                  </TableTr>
                ))}
              </TableTbody>
            </Table>
          </Paper>
        ) : (
          <EmptyState title="Nothing waiting" description="Products suppliers send for approval appear here. They are not on sale until approved." />
        )
      ) : cat.categories.length ? (
        cat.categories.map((c) => {
          const items = cat.products.filter((p) => p.categoryId === c.id);
          const orderBy = c.orderByOffsetDays !== null && cat.edition.buildUpStartsAt ? new Date(cat.edition.buildUpStartsAt.getTime() - c.orderByOffsetDays * DAY) : null;
          return (
            <Paper key={c.id} withBorder>
              <Group justify="space-between" p="md" wrap="nowrap" align="flex-start">
                <div style={{ minWidth: 0 }}>
                  <Group gap="xs">
                    <Title order={2} fz="md">
                      {c.name}
                    </Title>
                    <CategoryButton
                      editionId={edition.id}
                      initial={{
                        id: c.id,
                        name: c.name,
                        description: c.description ?? '',
                        supplierId: c.supplierId,
                        orderByOffsetDays: c.orderByOffsetDays,
                        visibleToTypes: c.visibleToTypes,
                        commissionType: c.commissionType,
                        commissionValue: c.commissionValue,
                      }}
                      suppliers={supplierOptions}
                      types={typeOptions}
                      canSetCommission={cat.canSetCommission}
                    />
                  </Group>
                  <Text fz="xs" c="dimmed">
                    {c.supplierName ? `Supplied by ${c.supplierName}` : 'Provided by Media10'} · Commission: {commissionLabel(c.commissionType, c.commissionValue)}
                    {orderBy ? ` · Order by ${dateLong(orderBy, cat.edition.timezone)}` : ''}
                  </Text>
                  <Group gap={4} mt={4}>
                    {c.visibleToTypes.length ? (
                      c.visibleToTypes.map((t) => (
                        <Badge key={t} size="xs" variant="light">
                          {typeName.get(t) ?? 'Unknown type'}
                        </Badge>
                      ))
                    ) : (
                      <Badge size="xs" variant="light" color="gray">
                        All stand types
                      </Badge>
                    )}
                  </Group>
                </div>
                <Group gap="xs" wrap="nowrap">
                  <ButtonLink href={`${base}/products/new?category=${c.id}`} size="xs" variant="light">
                    Add product
                  </ButtonLink>
                  <CategoryRowActions categoryId={c.id} name={c.name} />
                </Group>
              </Group>
              {items.length ? (
                <Table verticalSpacing="xs">
                  <TableThead>
                    <TableTr>
                      <TableTh w={64} />
                      <TableTh>Product</TableTh>
                      <TableTh>Price (before VAT)</TableTh>
                      <TableTh>Sold</TableTh>
                      <TableTh>Status</TableTh>
                      <TableTh w={120} />
                    </TableTr>
                  </TableThead>
                  <TableTbody>
                    {items.map((p) => (
                      <TableTr key={p.id}>
                        <TableTd>{p.imageFileId ? <Image src={`/files/${p.imageFileId}`} alt="" w={48} h={36} fit="contain" radius="sm" /> : null}</TableTd>
                        <TableTd>
                          <TextLink href={`${base}/products/${p.id}`} fw={600} fz="sm">
                            {p.name}
                          </TextLink>
                          {p.code ? (
                            <Text fz="xs" c="dimmed">
                              Code {p.code}
                            </Text>
                          ) : null}
                          <Text fz="xs" c="dimmed">
                            {p.options.map((o) => `${o.name}: ${o.values.join(', ')}`).join(' · ')}
                          </Text>
                        </TableTd>
                        <TableTd>
                          <Text fz="sm">
                            {money(p.pricePence)} {p.unit !== 'each' ? p.unit : ''}
                          </Text>
                          <Text fz="xs" c="dimmed">
                            {p.earlyPricePence !== null ? `Early ${money(p.earlyPricePence)} · ` : ''}
                            {p.latePricePence !== null ? `Late ${money(p.latePricePence)} · ` : ''}VAT {percentFromBps(p.vatRateBps)}
                          </Text>
                        </TableTd>
                        <TableTd>
                          <Text fz="sm">{p.stockLimit !== null ? `${p.sold} of ${p.stockLimit}` : p.sold}</Text>
                        </TableTd>
                        <TableTd>
                          <StatusBadge status={p.status} label={STATUS_LABELS[p.status]} />
                        </TableTd>
                        <TableTd>
                          <ProductRowActions productId={p.id} name={p.name} status={p.status} />
                        </TableTd>
                      </TableTr>
                    ))}
                  </TableTbody>
                </Table>
              ) : (
                <Text px="md" pb="md" fz="sm" c="dimmed">
                  No products yet.
                </Text>
              )}
            </Paper>
          );
        })
      ) : (
        <EmptyState title="No categories yet" description="Start with a category such as Furniture or Electrics, choose who supplies it, then add products." />
      )}
    </Stack>
  );
}
