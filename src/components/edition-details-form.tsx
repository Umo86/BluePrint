'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Group, NumberInput, Paper, Select, Stack, Text, TextInput } from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { useAction } from '@/lib/use-action';
import type { ActionResult } from '@/lib/action-result';

export type EditionDetailsValues = {
  id: string;
  name: string;
  slug: string;
  venue: string;
  city: string;
  status: string;
  vatRateBps: number;
  buildUpStartsAt: string | null;
  openStartsAt: string | null;
  openEndsAt: string | null;
  breakdownEndsAt: string | null;
};

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft (only the team can see it)' },
  { value: 'live', label: 'Live (exhibitors can sign in)' },
  { value: 'onsite', label: 'On site' },
  { value: 'closed', label: 'Closed (read-only for exhibitors)' },
  { value: 'archived', label: 'Archived' },
];

type SaveAction = (
  editionId: string,
  input: {
    name: string;
    slug: string;
    venue: string;
    city: string;
    status: 'draft' | 'live' | 'onsite' | 'closed' | 'archived';
    vatRateBps: number;
    buildUpStartsAt: string | null;
    openStartsAt: string | null;
    openEndsAt: string | null;
    breakdownEndsAt: string | null;
  },
) => Promise<ActionResult>;

/** Name, address, dates, status and VAT of an edition. Used by super admins and show admins. */
export function EditionDetailsForm({ edition, action, allowArchive }: { edition: EditionDetailsValues; action: SaveAction; allowArchive: boolean }) {
  const router = useRouter();
  const [f, setF] = useState(edition);
  const save = useAction(action, { onSuccess: () => router.refresh() });
  return (
    <Paper withBorder p="lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.run(edition.id, {
            name: f.name,
            slug: f.slug,
            venue: f.venue,
            city: f.city,
            status: f.status as 'draft',
            vatRateBps: f.vatRateBps,
            buildUpStartsAt: f.buildUpStartsAt,
            openStartsAt: f.openStartsAt,
            openEndsAt: f.openEndsAt,
            breakdownEndsAt: f.breakdownEndsAt,
          });
        }}
      >
        <Stack>
          <Group grow>
            <TextInput label="Edition name" required value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} error={save.fieldErrors.name} />
            <TextInput
              label="Web address"
              description={`Exhibitors use /portal/${f.slug || '…'}`}
              value={f.slug}
              onChange={(e) => setF({ ...f, slug: e.currentTarget.value })}
              error={save.fieldErrors.slug}
            />
          </Group>
          <Group grow>
            <TextInput label="Venue" value={f.venue} onChange={(e) => setF({ ...f, venue: e.currentTarget.value })} />
            <TextInput label="City" value={f.city} onChange={(e) => setF({ ...f, city: e.currentTarget.value })} />
          </Group>
          <Group grow>
            <DateTimePicker label="Build-up starts" value={f.buildUpStartsAt} onChange={(v) => setF({ ...f, buildUpStartsAt: v })} clearable />
            <DateTimePicker label="Show opens" value={f.openStartsAt} onChange={(v) => setF({ ...f, openStartsAt: v })} clearable />
          </Group>
          <Group grow>
            <DateTimePicker label="Show closes" value={f.openEndsAt} onChange={(v) => setF({ ...f, openEndsAt: v })} clearable />
            <DateTimePicker label="Breakdown ends" value={f.breakdownEndsAt} onChange={(v) => setF({ ...f, breakdownEndsAt: v })} clearable />
          </Group>
          <Group grow>
            <Select
              label="Status"
              data={STATUS_OPTIONS.filter((o) => allowArchive || o.value !== 'archived' || f.status === 'archived')}
              value={f.status}
              onChange={(v) => v && setF({ ...f, status: v })}
              allowDeselect={false}
            />
            <NumberInput
              label="VAT rate (%)"
              value={f.vatRateBps / 100}
              onChange={(v) => setF({ ...f, vatRateBps: Math.round(Number(v || 0) * 100) })}
              min={0}
              max={100}
              decimalScale={2}
            />
          </Group>
          <Text fz="xs" c="dimmed">
            Times are UK time. Deadlines set as “days before build-up” move automatically when you change the build-up date.
          </Text>
          <Group>
            <Button type="submit" loading={save.pending}>
              Save details
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  );
}
