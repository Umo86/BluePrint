import { Stack } from '@mantine/core';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { TextLink } from '@/components/links';
import { ProductForm } from '@/components/product-form';
import { getSupplierProduct, supplierCategories } from '@/server/services/catalogue';
import { AppError } from '@/server/errors';
import { loadSupplier } from '../../load';

const STATUS_LABELS: Record<string, string> = { draft: 'Draft', pending_approval: 'Awaiting approval', approved: 'On sale', rejected: 'Changes needed', archived: 'Off sale' };

export default async function EditSupplierProduct({ params }: PageProps<'/supplier/[supplierId]/catalogue/[productId]'>) {
  const { supplierId, productId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(productId)) notFound();
  const { actor, editable } = await loadSupplier(supplierId);
  let found: Awaited<ReturnType<typeof getSupplierProduct>>;
  try {
    found = await getSupplierProduct(actor, supplierId, productId);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
  const p = found.product;
  if (p.status === 'archived') notFound();
  const cats = (await supplierCategories(actor, supplierId)).filter((c) => c.edition.id === p.editionId);
  return (
    <Stack maw={860}>
      <TextLink href={`/supplier/${supplierId}/catalogue`} fz="sm">
        ← Your catalogue
      </TextLink>
      <PageHeader title={p.name} description={`${found.sold} sold`} actions={<StatusBadge status={p.status} label={STATUS_LABELS[p.status]} />} />
      {editable ? (
        <ProductForm
          mode={{ kind: 'supplier', supplierId, productId: p.id, editionIdFor: Object.fromEntries(cats.map((c) => [c.category.id, c.edition.id])), afterSaveHref: `/supplier/${supplierId}/catalogue` }}
          status={p.status}
          rejectionReason={p.rejectionReason}
          initial={{
            categoryId: p.categoryId,
            name: p.name,
            description: p.description ?? '',
            imageFileId: p.imageFileId,
            unit: p.unit,
            pricePence: p.pricePence,
            earlyPricePence: p.earlyPricePence,
            earlyUntilOffsetDays: p.earlyUntilOffsetDays,
            latePricePence: p.latePricePence,
            lateFromOffsetDays: p.lateFromOffsetDays,
            vatRateBps: p.vatRateBps,
            options: p.options,
            requiredDetails: p.requiredDetails.filter((q) => q.type !== 'file').map((q) => ({ id: q.id, label: q.label, type: q.type === 'textarea' ? 'textarea' : 'text', required: q.required })),
            stockLimit: p.stockLimit,
            visibleToTypes: [],
            commissionType: null,
            commissionValue: null,
          }}
          categories={cats.map((c) => ({ value: c.category.id, label: `${c.category.name} · ${c.edition.name}` }))}
        />
      ) : null}
    </Stack>
  );
}
