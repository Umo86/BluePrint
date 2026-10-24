'use client';

import { Select } from '@mantine/core';
import { useAction } from '@/lib/use-action';
import { setLineFulfilmentAction } from '@/app/manage/shop-actions';

/** Moves an order line through new, confirmed and delivered (suppliers for their own lines, and the show team). */
export function FulfilmentSelect({ lineId, value, label }: { lineId: string; value: string; label: string }) {
  const act = useAction(setLineFulfilmentAction);
  return (
    <Select
      aria-label={`Status of ${label}`}
      size="xs"
      w={130}
      data={[
        { value: 'received', label: 'New' },
        { value: 'confirmed', label: 'Confirmed' },
        { value: 'delivered', label: 'Delivered' },
      ]}
      value={value}
      onChange={(v) => v && v !== value && act.run(lineId, v as 'received' | 'confirmed' | 'delivered')}
      allowDeselect={false}
      disabled={act.pending}
    />
  );
}
