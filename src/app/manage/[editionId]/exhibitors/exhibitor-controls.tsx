'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Alert,
  Autocomplete,
  Button,
  Checkbox,
  Divider,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import { addExhibitorAction, searchCompaniesAction } from '../../actions';

type Option = { value: string; label: string };

export function ExhibitorFilters({ types, halls, tasks, categories, counts }: { types: Option[]; halls: Option[]; tasks: Option[]; categories: Option[]; counts: Record<string, number> }) {
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
  const state = params.get('state') ?? 'all';
  return (
    <Stack gap="sm">
      <SegmentedControl
        value={state}
        onChange={(v) => update({ state: v === 'all' ? null : v })}
        data={[
          { value: 'all', label: `All (${counts.all})` },
          { value: 'joined', label: `Signed up (${counts.joined})` },
          { value: 'invited', label: `Invited (${counts.invited})` },
          { value: 'not_sent', label: `Not sent (${counts.not_sent})` },
          { value: 'no_contact', label: `No contact (${counts.no_contact})` },
          { value: 'never_signed_in', label: `Never signed in (${counts.never_signed_in})` },
        ]}
        style={{ alignSelf: 'flex-start' }}
      />
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: q.trim() || null });
        }}
      >
        <Group gap="sm" align="flex-end">
          <TextInput
            aria-label="Search exhibitors"
            placeholder="Company, stand or contact"
            leftSection={<IconSearch size={16} />}
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            w={300}
          />
          <Button type="submit" variant="default">
            Search
          </Button>
          <Select aria-label="Stand type" placeholder="Any stand type" data={types} value={params.get('type')} onChange={(v) => update({ type: v })} clearable w={220} />
          {halls.length ? <Select aria-label="Hall" placeholder="Any hall" data={halls} value={params.get('hall')} onChange={(v) => update({ hall: v })} clearable w={160} /> : null}
        </Group>
      </form>
      <Group gap="sm">
        <Select
          aria-label="Checklist"
          placeholder="Any checklist progress"
          data={[
            { value: 'behind', label: 'Behind (overdue tasks)' },
            { value: 'review', label: 'Waiting for your review' },
            { value: 'changes', label: 'Changes asked for' },
            { value: 'not_started', label: 'Not started' },
            { value: 'complete', label: 'All required tasks done' },
          ]}
          value={params.get('progress')}
          onChange={(v) => update({ progress: v })}
          clearable
          w={240}
        />
        {tasks.length ? (
          <Select
            aria-label="Task not done"
            placeholder="Has not done…"
            data={tasks}
            value={params.get('task')}
            onChange={(v) => update({ task: v })}
            clearable
            searchable
            w={300}
          />
        ) : null}
        {categories.length ? (
          <Select
            aria-label="Has not ordered from"
            placeholder="Has not ordered from…"
            data={categories}
            value={params.get('notOrdered')}
            onChange={(v) => update({ notOrdered: v })}
            clearable
            w={260}
          />
        ) : null}
      </Group>
    </Stack>
  );
}

export function StandFields({
  value,
  onChange,
  types,
  halls,
  errors,
}: {
  value: { number: string; exhibitorTypeId: string | null; hallId: string | null; sizeSqm: number | null; openSides: number; notes: string };
  onChange: (v: typeof value) => void;
  types: Option[];
  halls: Option[];
  errors: Record<string, string>;
}) {
  return (
    <Stack gap="sm">
      <Group grow align="flex-start">
        <TextInput label="Stand number" required value={value.number} onChange={(e) => onChange({ ...value, number: e.currentTarget.value })} error={errors.number ?? errors['stand.number']} />
        <Select
          label="Stand type"
          required
          data={types}
          value={value.exhibitorTypeId}
          onChange={(v) => onChange({ ...value, exhibitorTypeId: v })}
          error={errors.exhibitorTypeId ?? errors['stand.exhibitorTypeId']}
          allowDeselect={false}
        />
      </Group>
      <Group grow align="flex-start">
        <Select label="Hall" data={halls} value={value.hallId} onChange={(v) => onChange({ ...value, hallId: v })} clearable placeholder={halls.length ? 'Choose' : 'Add halls in show settings'} />
        <NumberInput label="Size (sqm)" value={value.sizeSqm ?? ''} onChange={(v) => onChange({ ...value, sizeSqm: v === '' ? null : Number(v) })} min={0} decimalScale={2} />
        <NumberInput label="Open sides" value={value.openSides} onChange={(v) => onChange({ ...value, openSides: Number(v || 0) })} min={0} max={4} />
      </Group>
      <TextInput label="Notes for the team" value={value.notes} onChange={(e) => onChange({ ...value, notes: e.currentTarget.value })} />
    </Stack>
  );
}

export function AddExhibitorButton({ editionId, types, halls, isDraft }: { editionId: string; types: Option[]; halls: Option[]; isDraft: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState<{ id: string; name: string; website: string | null; city: string | null }[]>([]);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [stand, setStand] = useState({ number: '', exhibitorTypeId: (types[0]?.value ?? null) as string | null, hallId: null as string | null, sizeSqm: null as number | null, openSides: 1, notes: '' });
  const [email, setEmail] = useState('');
  const [sendNow, setSendNow] = useState(!isDraft);
  const add = useAction(addExhibitorAction, {
    onSuccess: (data) => {
      setOpen(false);
      if (data?.companyId) router.push(`/manage/${editionId}/exhibitors/${data.companyId}`);
    },
  });
  const lookup = useAction(searchCompaniesAction, { notifyErrors: false, onSuccess: (data) => setMatches(data ?? []) });

  useEffect(() => {
    if (mode !== 'existing' || search.trim().length < 2) return;
    const t = setTimeout(() => lookup.run(editionId, search), 250);
    return () => clearTimeout(t);
  }, [search, mode, editionId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Button leftSection={<IconPlus size={16} />} onClick={() => setOpen(true)}>
        Add exhibitor
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title="Add an exhibitor" size="lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add.run(editionId, {
              existingCompanyId: mode === 'existing' ? existingId : null,
              company: mode === 'new' ? { name, website } : undefined,
              stand: { ...stand, exhibitorTypeId: stand.exhibitorTypeId ?? '', hallId: stand.hallId, notes: stand.notes || null },
              contact: email.trim() ? { email, sendNow } : null,
            });
          }}
        >
          <Stack>
            <SegmentedControl
              value={mode}
              onChange={(v) => setMode(v as 'new' | 'existing')}
              data={[
                { value: 'new', label: 'New company' },
                { value: 'existing', label: 'Company already in BluePrint' },
              ]}
            />
            {mode === 'new' ? (
              <Group grow align="flex-start">
                <TextInput label="Company name" required value={name} onChange={(e) => setName(e.currentTarget.value)} error={add.fieldErrors.name ?? add.fieldErrors['company.name']} data-autofocus />
                <TextInput label="Website" value={website} onChange={(e) => setWebsite(e.currentTarget.value)} error={add.fieldErrors['company.website']} />
              </Group>
            ) : (
              <Autocomplete
                label="Find the company"
                description="Companies from earlier shows keep their record, so look them up first."
                placeholder="Start typing a name"
                value={search}
                onChange={(v) => {
                  setSearch(v);
                  setExistingId(null);
                }}
                data={matches.map((m) => ({ value: m.id, label: [m.name, m.city].filter(Boolean).join(' · ') }))}
                onOptionSubmit={(v) => {
                  setExistingId(v);
                  const m = matches.find((x) => x.id === v);
                  if (m) setSearch(m.name);
                }}
                filter={({ options }) => options}
                error={mode === 'existing' && add.error && !existingId ? 'Choose a company from the list.' : undefined}
              />
            )}
            <Divider label="Stand" labelPosition="left" />
            <StandFields value={stand} onChange={setStand} types={types} halls={halls} errors={add.fieldErrors} />
            <Divider label="Main contact (optional)" labelPosition="left" />
            <TextInput label="Contact email" type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} error={add.fieldErrors.email} />
            {email.trim() ? (
              <Checkbox
                label="Send the invitation now"
                description={isDraft ? 'The show is still a draft, so the invitation will be saved and you can send it once the show is live.' : 'Otherwise it is saved and you can send all saved invitations together.'}
                checked={sendNow && !isDraft}
                disabled={isDraft}
                onChange={(e) => setSendNow(e.currentTarget.checked)}
              />
            ) : null}
            {add.error ? <Alert color="red">{add.error}</Alert> : null}
            <Group justify="flex-end">
              <Button type="submit" loading={add.pending} disabled={mode === 'existing' && !existingId}>
                Add exhibitor
              </Button>
            </Group>
            <Text fz="xs" c="dimmed">
              You can add more stands and people on the exhibitor’s page.
            </Text>
          </Stack>
        </form>
      </Modal>
    </>
  );
}
