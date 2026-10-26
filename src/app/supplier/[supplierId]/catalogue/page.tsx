import { Alert, Image, Paper, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, Title } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { ButtonLink, TextLink } from '@/components/links';
import { supplierCatalogue } from '@/server/services/catalogue';
import { money, percentFromBps } from '@/lib/format';
import { loadSupplier } from '../load';
import { SupplierProductActions } from './catalogue-actions';

const STATUS_LABELS: Record<string, string> = { draft: 'Draft', pending_approval: 'Awaiting approval', approved: 'On sale', rejected: 'Changes needed', archived: 'Off sale' };

export default async function SupplierCataloguePage({ params }: PageProps<'/supplier/[supplierId]/catalogue'>) {
  const { supplierId } = await params;
  const { actor, editable } = await loadSupplier(supplierId);
  const { categories, products } = await supplierCatalogue(actor, supplierId);
  const base = `/supplier/${supplierId}/catalogue`;
  const open = categories.filter((c) => c.edition.status !== 'closed');
  return (
    <Stack>
      <PageHeader
        title="Your catalogue"
        description="Products you offer exhibitors, by show. New products and price changes go to the show team for approval before they are on sale."
        actions={open.length && editable ? <ButtonLink href={`${base}/new`}>Add a product</ButtonLink> : null}
      />
      {products.some((p) => p.status === 'rejected') ? <Alert color="orange">The show team has asked for changes on some products. Open them to see what they said.</Alert> : null}
      {categories.length ? (
        categories.map(({ category, edition }) => {
          const items = products.filter((p) => p.categoryId === category.id);
          return (
            <Paper key={category.id} withBorder>
              <Stack gap={2} p="md">
                <Title order={2} fz="md">
                  {category.name}
                </Title>
                <Text fz="xs" c="dimmed">
                  {edition.name}
                </Text>
              </Stack>
              {items.length ? (
                <Table verticalSpacing="xs">
                  <TableThead>
                    <TableTr>
                      <TableTh w={64} />
                      <TableTh>Product</TableTh>
                      <TableTh>Price (before VAT)</TableTh>
                      <TableTh>Sold</TableTh>
                      <TableTh>Status</TableTh>
                      <TableTh />
                    </TableTr>
                  </TableThead>
                  <TableTbody>
                    {items.map((p) => (
                      <TableTr key={p.id}>
                        <TableTd>{p.imageFileId ? <Image src={`/files/${p.imageFileId}`} alt="" w={48} h={36} fit="contain" radius="sm" /> : null}</TableTd>
                        <TableTd>
                          {p.status === 'archived' ? (
                            <Text fz="sm" fw={600}>
                              {p.name}
                            </Text>
                          ) : (
                            <TextLink href={`${base}/${p.id}`} fw={600} fz="sm">
                              {p.name}
                            </TextLink>
                          )}
                          {p.code ? (
                            <Text fz="xs" c="dimmed">
                              Code {p.code}
                            </Text>
                          ) : null}
                          {p.status === 'rejected' && p.rejectionReason ? (
                            <Text fz="xs" c="orange" lineClamp={2}>
                              {p.rejectionReason}
                            </Text>
                          ) : null}
                        </TableTd>
                        <TableTd>
                          <Text fz="sm">{money(p.pricePence)}</Text>
                          <Text fz="xs" c="dimmed">
                            VAT {percentFromBps(p.vatRateBps)}
                          </Text>
                        </TableTd>
                        <TableTd>{p.stockLimit !== null ? `${p.sold} of ${p.stockLimit}` : p.sold}</TableTd>
                        <TableTd>
                          <StatusBadge status={p.status} label={STATUS_LABELS[p.status]} />
                        </TableTd>
                        <TableTd>{editable ? <SupplierProductActions supplierId={supplierId} productId={p.id} name={p.name} status={p.status} /> : null}</TableTd>
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
        <EmptyState title="No shows yet" description="Once the show team assigns you a category in a show, you can add products here." />
      )}
    </Stack>
  );
}
