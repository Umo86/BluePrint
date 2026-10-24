import { Stack } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { loadSupplier } from '../load';
import { SupplierDetailsForm } from './details-form';

export default async function SupplierDetailsPage({ params }: PageProps<'/supplier/[supplierId]/details'>) {
  const { supplierId } = await params;
  const { supplier, editable } = await loadSupplier(supplierId);
  return (
    <Stack>
      <PageHeader title="Your details" description="How exhibitors and the show team see you, and where we send order emails. To add or remove colleagues, contact the show team." />
      <SupplierDetailsForm supplierId={supplier.id} editable={editable} initial={{ name: supplier.name, email: supplier.email, phone: supplier.phone ?? '', website: supplier.website ?? '' }} />
    </Stack>
  );
}
