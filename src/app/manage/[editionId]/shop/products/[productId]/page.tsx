import { Alert, Group, Stack, Text } from '@mantine/core';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { TextLink } from '@/components/links';
import { ProductForm } from '@/components/product-form';
import { catalogueForStaff, getProductForStaff } from '@/server/services/catalogue';
import { AppError } from '@/server/errors';
import { loadEdition } from '../../../load';
import { ApprovalButtons } from '../../catalogue-controls';

const STATUS_LABELS: Record<string, string> = { draft: 'Draft', pending_approval: 'Awaiting approval', approved: 'On sale', rejected: 'Sent back', archived: 'Off sale' };

export default async function EditProduct({ params }: PageProps<'/manage/[editionId]/shop/products/[productId]'>) {
  const { editionId, productId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(productId)) notFound();
  const { actor, edition } = await loadEdition(editionId, 'manage_orders');
  let detail: Awaited<ReturnType<typeof getProductForStaff>>;
  try {
    detail = await getProductForStaff(actor, productId);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
  const p = detail.product;
  if (p.editionId !== edition.id) notFound();
  const cat = await catalogueForStaff(actor, edition.id);
  return (
    <Stack maw={860}>
      <TextLink href={`/manage/${edition.id}/shop`} fz="sm">
        ← Shop catalogue
      </TextLink>
      <PageHeader
        title={p.name}
        description={
          <>
            {detail.supplier ? `Supplied by ${detail.supplier.name}` : 'Provided by you'} · {detail.sold} sold
          </>
        }
        actions={
          <Group gap="xs">
            <StatusBadge status={p.status} label={STATUS_LABELS[p.status]} />
            {p.status === 'pending_approval' ? <ApprovalButtons productId={p.id} name={p.name} /> : null}
          </Group>
        }
      />
      {detail.hasOrders ? (
        <Alert color="blue">
          <Text fz="sm">This product has been ordered. Changing it does not change orders already placed; they keep the price and details they were bought with.</Text>
        </Alert>
      ) : null}
      <ProductForm
        mode={{
          kind: 'staff',
          editionId: edition.id,
          productId: p.id,
          canSetCommission: detail.canSetCommission,
          types: cat.types.map((t) => ({ value: t.id, label: t.name })),
          afterSaveHref: `/manage/${edition.id}/shop`,
        }}
        status={p.status}
        rejectionReason={p.rejectionReason}
        initial={{
          categoryId: p.categoryId,
          name: p.name,
          code: p.code ?? '',
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
          requiredDetails: p.requiredDetails.map((q) => ({ id: q.id, label: q.label, type: q.type, required: q.required })),
          stockLimit: p.stockLimit,
          visibleToTypes: p.visibleToTypes,
          commissionType: p.commissionType,
          commissionValue: p.commissionValue,
        }}
        categories={cat.categories.map((c) => ({ value: c.id, label: c.name }))}
      />
    </Stack>
  );
}
