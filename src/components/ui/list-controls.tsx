'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button, Group, Pagination, Select, Text, TextInput } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';

function useParamUpdater() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };
}

/** Search box and optional filter that live in the page address, so results can be bookmarked. */
export function SearchFilter({
  placeholder = 'Search',
  filterOptions,
  filterParam = 'filter',
  filterLabel,
}: {
  placeholder?: string;
  filterOptions?: { value: string; label: string }[];
  filterParam?: string;
  filterLabel?: string;
}) {
  const params = useSearchParams();
  const update = useParamUpdater();
  const [q, setQ] = useState(params.get('q') ?? '');
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        update({ q: q.trim() || null, page: null });
      }}
    >
      <Group gap="sm" align="flex-end">
        <TextInput
          aria-label={placeholder}
          placeholder={placeholder}
          leftSection={<IconSearch size={16} />}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          onBlur={() => {
            if ((params.get('q') ?? '') !== q.trim()) update({ q: q.trim() || null, page: null });
          }}
          w={320}
        />
        <Button type="submit" variant="default">
          Search
        </Button>
        {filterOptions ? (
          <Select
            aria-label={filterLabel ?? 'Filter'}
            data={filterOptions}
            value={params.get(filterParam) ?? filterOptions[0]?.value ?? null}
            onChange={(v) => update({ [filterParam]: v && v !== filterOptions[0]?.value ? v : null, page: null })}
            allowDeselect={false}
            w={220}
          />
        ) : null}
      </Group>
    </form>
  );
}

export function PageNav({ total, page, pageSize }: { total: number; page: number; pageSize: number }) {
  const update = useParamUpdater();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <Group justify="space-between" mt="md">
      <Text fz="sm" c="dimmed">
        {total === 0 ? 'Nothing found' : `Showing ${(page - 1) * pageSize + 1}–${Math.min(total, page * pageSize)} of ${total}`}
      </Text>
      {pages > 1 ? <Pagination total={pages} value={page} onChange={(p) => update({ page: p === 1 ? null : String(p) })} size="sm" /> : null}
    </Group>
  );
}

/** One choice that lives in the page address (for example which show), without a search box. */
export function ParamSelect({ param, label, options, width = 260 }: { param: string; label: string; options: { value: string; label: string }[]; width?: number }) {
  const params = useSearchParams();
  const update = useParamUpdater();
  return (
    <Select
      label={label}
      data={options}
      value={params.get(param) ?? options[0]?.value ?? null}
      onChange={(v) => update({ [param]: v && v !== options[0]?.value ? v : null, page: null })}
      allowDeselect={false}
      w={width}
      maw="100%"
    />
  );
}
