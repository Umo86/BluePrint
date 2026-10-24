import { Stack } from '@mantine/core';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { TextLink } from '@/components/links';
import { ProductForm } from '@/components/product-form';
import { emptyProduct } from '@/lib/product-defaults';
import { catalogueForStaff } from '@/server/services/catalogue';
import { loadEdition } from '../../../load';

export default async function NewProduct({ params, searchParams }: PageProps<'/manage/[editionId]/shop/products/new'>) {
  const { editionId } = await params;
  const sp = await searchParams;
  const { actor, edition } = await loadEdition(editionId, 'manage_orders');
  const cat = await catalogueForStaff(actor, edition.id);
  if (!cat.categories.length) notFound();
  const wanted = typeof sp.category === 'string' ? sp.category : null;
  const categoryId = cat.categories.find((c) => c.id === wanted)?.id ?? cat.categories[0].id;
  return (
    <Stack maw={860}>
      <TextLink href={`/manage/${edition.id}/shop`} fz="sm">
        ← Shop catalogue
      </TextLink>
      <PageHeader title="Add a product" description="Prices are entered before VAT. Exhibitors see the price including VAT." />
      <ProductForm
        mode={{ kind: 'staff', editionId: edition.id, canSetCommission: cat.canSetCommission, types: cat.types.map((t) => ({ value: t.id, label: t.name })), afterSaveHref: `/manage/${edition.id}/shop` }}
        initial={emptyProduct(categoryId, edition.vatRateBps)}
        categories={cat.categories.map((c) => ({ value: c.id, label: c.name }))}
      />
    </Stack>
  );
}
