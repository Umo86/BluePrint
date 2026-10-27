'use client';

import { useRouter } from 'next/navigation';
import { Select } from '@mantine/core';
import { useAction } from '@/lib/use-action';
import { chooseStandAction } from '../actions';

export function StandSwitcher({ slug, current, stands }: { slug: string; current: string; stands: { id: string; label: string }[] }) {
  const router = useRouter();
  const choose = useAction(chooseStandAction, { onSuccess: () => router.refresh() });
  return (
    <Select
      aria-label="Choose your stand"
      size="xs"
      w={{ base: 140, sm: 240 }}
      data={stands.map((s) => ({ value: s.id, label: s.label }))}
      value={current}
      onChange={(v) => v && v !== current && choose.run(slug, v)}
      allowDeselect={false}
      disabled={choose.pending}
    />
  );
}
