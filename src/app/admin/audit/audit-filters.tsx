'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button, Group, Paper, Select, TextInput } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';

export function AuditFilterForm({ editions }: { editions: { value: string; label: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [f, setF] = useState({
    action: params.get('action') ?? '',
    who: params.get('who') ?? '',
    edition: params.get('edition'),
    entity: params.get('entity') ?? '',
    from: params.get('from'),
    to: params.get('to'),
  });
  const apply = () => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) next.set(k, v);
    router.push(next.toString() ? `${pathname}?${next}` : pathname);
  };
  return (
    <Paper withBorder p="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <Group align="flex-end" gap="sm">
          <TextInput label="Action starts with" placeholder="order. or user.disabled" value={f.action} onChange={(e) => setF({ ...f, action: e.currentTarget.value })} w={190} />
          <TextInput label="Who (email)" value={f.who} onChange={(e) => setF({ ...f, who: e.currentTarget.value })} w={200} />
          <Select label="Edition" data={editions} value={f.edition} onChange={(v) => setF({ ...f, edition: v })} clearable searchable w={220} />
          <TextInput label="Record ID" value={f.entity} onChange={(e) => setF({ ...f, entity: e.currentTarget.value })} w={150} />
          <DatePickerInput label="From" value={f.from} onChange={(v) => setF({ ...f, from: v })} clearable w={140} valueFormat="D MMM YYYY" />
          <DatePickerInput label="To" value={f.to} onChange={(v) => setF({ ...f, to: v })} clearable w={140} valueFormat="D MMM YYYY" />
          <Button type="submit">Filter</Button>
          <Button
            variant="subtle"
            onClick={() => {
              setF({ action: '', who: '', edition: null, entity: '', from: null, to: null });
              router.push(pathname);
            }}
          >
            Clear
          </Button>
        </Group>
      </form>
    </Paper>
  );
}
