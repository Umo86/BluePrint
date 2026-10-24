'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Group, Modal, NumberInput, Paper, SegmentedControl, Stack, Switch, Text, TextInput, Title } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import { createSupplierAction, inviteSupplierUserAction, updateSupplierAction, updateSupplierCommissionAction } from '../actions';

type SupplierValues = { name: string; email: string; phone: string; website: string };

function SupplierFields({ f, setF, errors }: { f: SupplierValues; setF: (v: SupplierValues) => void; errors: Record<string, string> }) {
  return (
    <Stack gap="sm">
      <TextInput label="Supplier name" required value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} error={errors.name} />
      <TextInput
        label="Orders email"
        description="Where new order notifications go."
        type="email"
        required
        value={f.email}
        onChange={(e) => setF({ ...f, email: e.currentTarget.value })}
        error={errors.email}
      />
      <Group grow>
        <TextInput label="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.currentTarget.value })} />
        <TextInput label="Website" value={f.website} onChange={(e) => setF({ ...f, website: e.currentTarget.value })} />
      </Group>
    </Stack>
  );
}

export function NewSupplierButton() {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<SupplierValues>({ name: '', email: '', phone: '', website: '' });
  const create = useAction(createSupplierAction);
  return (
    <>
      <Button leftSection={<IconPlus size={16} />} onClick={() => setOpen(true)}>
        New supplier
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title="New supplier">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.run(f);
          }}
        >
          <Stack>
            <SupplierFields f={f} setF={setF} errors={create.fieldErrors} />
            <Group justify="flex-end">
              <Button type="submit" loading={create.pending}>
                Create supplier
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
}

export function SupplierDetailsForm({ supplierId, initial }: { supplierId: string; initial: SupplierValues }) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const save = useAction(updateSupplierAction, { onSuccess: () => router.refresh() });
  return (
    <Paper withBorder p="md">
      <Title order={3} fz="md" mb="sm">
        Details
      </Title>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.run(supplierId, f);
        }}
      >
        <Stack>
          <SupplierFields f={f} setF={setF} errors={save.fieldErrors} />
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

export function SupplierCommissionForm({
  supplierId,
  type,
  value,
  defaultLabel,
  vatRegistered,
}: {
  supplierId: string;
  type: 'percent' | 'fixed' | null;
  value: number | null;
  defaultLabel: string;
  vatRegistered: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'default' | 'percent' | 'fixed'>(type ?? 'default');
  const [amount, setAmount] = useState<number>(value ?? 1000);
  const [vat, setVat] = useState(vatRegistered);
  const save = useAction(updateSupplierCommissionAction, { onSuccess: () => router.refresh() });
  return (
    <Paper withBorder p="md">
      <Title order={3} fz="md" mb={4}>
        Commission and VAT
      </Title>
      <Text fz="sm" c="dimmed" mb="sm">
        Taken from this supplier’s share of each order. Categories and products can set their own rate.
      </Text>
      <Stack>
        <SegmentedControl
          value={mode}
          onChange={(v) => setMode(v as typeof mode)}
          data={[
            { value: 'default', label: `Default (${defaultLabel})` },
            { value: 'percent', label: 'Percentage' },
            { value: 'fixed', label: 'Fixed per line' },
          ]}
        />
        {mode === 'percent' ? (
          <NumberInput label="Percent" value={amount / 100} onChange={(v) => setAmount(Math.round(Number(v || 0) * 100))} min={0} max={100} decimalScale={2} suffix="%" w={160} />
        ) : null}
        {mode === 'fixed' ? (
          <NumberInput label="Amount per order line" value={amount / 100} onChange={(v) => setAmount(Math.round(Number(v || 0) * 100))} min={0} decimalScale={2} prefix="£" w={160} />
        ) : null}
        <Switch
          label="VAT registered"
          description="VAT-registered suppliers are paid VAT on their share. Switch off for suppliers who do not charge VAT."
          checked={vat}
          onChange={(e) => setVat(e.currentTarget.checked)}
        />
        <Group>
          <Button loading={save.pending} onClick={() => save.run(supplierId, mode === 'default' ? null : mode, mode === 'default' ? null : amount, vat)}>
            Save commission and VAT
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

export function InviteSupplierUser({ supplierId }: { supplierId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const invite = useAction(inviteSupplierUserAction, {
    onSuccess: () => {
      setEmail('');
      router.refresh();
    },
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        invite.run(supplierId, email);
      }}
    >
      <Group align="flex-end" gap="xs">
        <TextInput label="Invite someone from this supplier" placeholder="name@supplier.co.uk" type="email" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} error={invite.fieldErrors.email} w={320} />
        <Button type="submit" loading={invite.pending}>
          Send invitation
        </Button>
      </Group>
    </form>
  );
}
