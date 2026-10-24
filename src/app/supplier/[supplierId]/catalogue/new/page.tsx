import { Stack } from '@mantine/core';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { TextLink } from '@/components/links';
import { ProductForm } from '@/components/product-form';
import { emptyProduct } from '@/lib/product-defaults';
import { supplierCategories } from '@/server/services/catalogue';
import { loadSupplier } from '../../load';

export default async function NewSupplierProduct({ params }: PageProps<'/supplier/[supplierId]/catalogue/new'>) {
  const { supplierId } = await params;
  const { actor, editable } = await loadSupplier(supplierId);
  const cats = (await supplierCategories(actor, supplierId)).filter((c) => c.edition.status !== 'closed');
  if (!cats.length || !editable) notFound();
  return (
    <Stack maw={860}>
      <TextLink href={`/supplier/${supplierId}/catalogue`} fz="sm">
        ← Your catalogue
      </TextLink>
      <PageHeader title="Add a product" description="Enter prices before VAT. The show team checks every product before exhibitors can buy it." />
      <ProductForm
        mode={{ kind: 'supplier', supplierId, editionIdFor: Object.fromEntries(cats.map((c) => [c.category.id, c.edition.id])), afterSaveHref: `/supplier/${supplierId}/catalogue` }}
        initial={emptyProduct(cats[0].category.id, cats[0].edition.vatRateBps)}
        categories={cats.map((c) => ({ value: c.category.id, label: `${c.category.name} · ${c.edition.name}` }))}
      />
    </Stack>
  );
}
