'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button, Group, Modal, Select, Stack, Text, TextInput } from '@mantine/core';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import { emptyStandForm } from '@/lib/stand-form';
import { createStandAction } from '../../actions';
import { StandFields } from '../exhibitors/exhibitor-controls';

type Option = { value: string; label: string };

export function StandFiltersBar({ types, halls }: { types: Option[]; halls: Option[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (!v) next.delete(k);
      else next.set(k, v);
    }
    router.push(next.toString() ? `${pathname}?${next}` : pathname);
  };
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        update({ q: q.trim() || null });
      }}
    >
      <Group gap="sm" align="flex-end">
        <TextInput aria-label="Search stands" placeholder="Stand number or company" leftSection={<IconSearch size={16} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} w={260} />
        <Button type="submit" variant="default">
          Search
        </Button>
        <Select aria-label="Stand type" placeholder="Any stand type" data={types} value={params.get('type')} onChange={(v) => update({ type: v })} clearable w={200} />
        {halls.length ? <Select aria-label="Hall" placeholder="Any hall" data={halls} value={params.get('hall')} onChange={(v) => update({ hall: v })} clearable w={150} /> : null}
        <Select
          aria-label="Status"
          data={[
            { value: 'active', label: 'Active stands' },
            { value: 'cancelled', label: 'Cancelled stands' },
            { value: 'all', label: 'All stands' },
          ]}
          value={params.get('status') ?? 'active'}
          onChange={(v) => update({ status: v === 'active' ? null : v })}
          allowDeselect={false}
          w={170}
        />
      </Group>
    </form>
  );
}

export function AddStandButton({ editionId, types, halls }: { editionId: string; types: Option[]; halls: Option[] }) {
  const [open, setOpen] = useState(false);
  const empty = emptyStandForm(types[0]?.value ?? null);
  const [v, setV] = useState(empty);
  const create = useAction(createStandAction, {
    onSuccess: () => {
      setOpen(false);
      setV(empty);
    },
  });
  return (
    <>
      <Button leftSection={<IconPlus size={16} />} onClick={() => setOpen(true)}>
        Add stand
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title="Add a stand" size="lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.run(editionId, { ...v, exhibitorTypeId: v.exhibitorTypeId ?? '', notes: v.notes || null, companyId: null });
          }}
        >
          <Stack>
            <StandFields value={v} onChange={setV} types={types} halls={halls} errors={create.fieldErrors} />
            <Text fz="xs" c="dimmed">
              The stand is added without a company. To add an exhibitor with their stand in one go, use Add exhibitor on the Exhibitors page.
            </Text>
            <Group justify="flex-end">
              <Button type="submit" loading={create.pending}>
                Add stand
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
}
