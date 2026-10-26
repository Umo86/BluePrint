'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button, Group, Paper, Select, TextInput } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { auditActionLabel } from '@/lib/audit-labels';

/** Each option filters on actions starting with its value. */
const AREAS = [
  { value: 'auth.', label: 'Sign-in and security' },
  { value: 'user.', label: 'People' },
  { value: 'invitation.', label: 'Invitations' },
  { value: 'staff.', label: 'Show teams' },
  { value: 'view_as.', label: 'Viewing as an exhibitor' },
  { value: 'show.', label: 'Shows' },
  { value: 'edition.', label: 'Editions' },
  { value: 'company.', label: 'Companies' },
  { value: 'exhibitor', label: 'Exhibitors and stand types' },
  { value: 'stand.', label: 'Stands' },
  { value: 'manual.', label: 'Manual pages' },
  { value: 'task.', label: 'Tasks' },
  { value: 'submission.', label: 'Task answers' },
  { value: 'file.', label: 'Files' },
  { value: 'space_only.', label: 'Space-only' },
  { value: 'shop.', label: 'Shop, orders and payments' },
  { value: 'supplier.', label: 'Suppliers' },
  { value: 'campaign.', label: 'Emails to exhibitors' },
  { value: 'email.', label: 'Email settings and delivery' },
  { value: 'announcement.', label: 'Announcements' },
  { value: 'ticket.', label: 'Help desk' },
  { value: 'assistant.', label: 'Assistant' },
  { value: 'report.', label: 'Reports and downloads' },
  { value: 'gdpr.', label: 'Privacy (GDPR)' },
  { value: 'settings.', label: 'Platform settings' },
];

/** The areas, plus the current filter if it is a single action (for example from a link). */
function areaOptions(current: string) {
  if (!current || AREAS.some((a) => a.value === current)) return AREAS;
  return [{ value: current, label: auditActionLabel(current) }, ...AREAS];
}

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
          <Select
            label="What"
            placeholder="Everything"
            data={areaOptions(f.action)}
            value={f.action || null}
            onChange={(v) => setF({ ...f, action: v ?? '' })}
            clearable
            searchable
            w={200}
          />
          <TextInput label="Who (email)" value={f.who} onChange={(e) => setF({ ...f, who: e.currentTarget.value })} w={180} />
          <Select label="Edition" data={editions} value={f.edition} onChange={(v) => setF({ ...f, edition: v })} clearable searchable w={200} />
          <TextInput label="Record ID" value={f.entity} onChange={(e) => setF({ ...f, entity: e.currentTarget.value })} w={130} />
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
