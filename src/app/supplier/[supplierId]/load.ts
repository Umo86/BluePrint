import 'server-only';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { requireActor } from '@/server/auth/current';
import { mySuppliers } from '@/server/services/catalogue';

/** The supplier this page is for, if the person signed in works for it; otherwise "not found". */
export const loadSupplier = cache(async (supplierId: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(supplierId)) notFound();
  const actor = await requireActor();
  const supplier = (await mySuppliers(actor)).find((s) => s.id === supplierId);
  if (!supplier) notFound();
  return { actor, supplier, editable: !actor.readOnly && supplier.status === 'active' };
});
