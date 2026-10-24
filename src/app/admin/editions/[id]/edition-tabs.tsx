'use client';

import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Group,
  NumberInput,
  Paper,
  SegmentedControl,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { modals } from '@mantine/modals';
import { useAction } from '@/lib/use-action';
import { commissionLabel, percentFromBps } from '@/lib/format';
import { StaffManager, type StaffRow, type PendingInvite } from '@/components/staff-manager';
import { EditionDetailsForm } from '@/components/edition-details-form';
import { cloneEditionAction, deleteEditionAction, updateCommercialAction, updateEditionAction } from '../../actions';

type EditionProps = {
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
  assistantEnabled: boolean;
  feeMode: 'exhibitor_pays' | 'deduct_from_supplier' | null;
  defaultCommissionType: 'percent' | 'fixed' | null;
  defaultCommissionValue: number | null;
};

type Props = {
  edition: EditionProps;
  platformFeeMode: 'exhibitor_pays' | 'deduct_from_supplier';
  platformCommission: { type: 'percent' | 'fixed'; value: number };
  staff: StaffRow[];
  pending: PendingInvite[];
  currentUserId: string;
};

export function EditionTabs({ edition, platformFeeMode, platformCommission, staff, pending, currentUserId }: Props) {
  return (
    <Tabs defaultValue="details" keepMounted={false}>
      <Tabs.List mb="md">
        <Tabs.Tab value="details">Details</Tabs.Tab>
        <Tabs.Tab value="commercial">Fees and commission</Tabs.Tab>
        <Tabs.Tab value="team">Team</Tabs.Tab>
        <Tabs.Tab value="clone">Clone for next year</Tabs.Tab>
        <Tabs.Tab value="danger" c="red">
          Delete
        </Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="details">
        <EditionDetailsForm edition={edition} action={updateEditionAction} allowArchive />
      </Tabs.Panel>
      <Tabs.Panel value="commercial">
        <CommercialForm edition={edition} platformFeeMode={platformFeeMode} platformCommission={platformCommission} />
      </Tabs.Panel>
      <Tabs.Panel value="team">
        <StaffManager editionId={edition.id} staff={staff} pending={pending} currentUserId={currentUserId} />
      </Tabs.Panel>
      <Tabs.Panel value="clone">
        <CloneForm edition={edition} />
      </Tabs.Panel>
      <Tabs.Panel value="danger">
        <DeletePanel edition={edition} />
      </Tabs.Panel>
    </Tabs>
  );
}

function CommercialForm({ edition, platformFeeMode, platformCommission }: { edition: EditionProps; platformFeeMode: string; platformCommission: { type: 'percent' | 'fixed'; value: number } }) {
  const [useDefaultFee, setUseDefaultFee] = useState(edition.feeMode === null);
  const [feeMode, setFeeMode] = useState(edition.feeMode ?? platformFeeMode);
  const [useDefaultCommission, setUseDefaultCommission] = useState(edition.defaultCommissionType === null);
  const [type, setType] = useState<'percent' | 'fixed'>(edition.defaultCommissionType ?? 'percent');
  const [value, setValue] = useState<number>(edition.defaultCommissionValue ?? 1000);
  const save = useAction(updateCommercialAction);
  return (
    <Paper withBorder p="lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.run(edition.id, {
            feeMode: useDefaultFee ? null : (feeMode as 'exhibitor_pays' | 'deduct_from_supplier'),
            defaultCommissionType: useDefaultCommission ? null : type,
            defaultCommissionValue: useDefaultCommission ? null : value,
          });
        }}
      >
        <Stack>
          <Text fw={600}>Card processing fee</Text>
          <Switch label={`Use the platform setting (${platformFeeMode === 'exhibitor_pays' ? 'added on top for the exhibitor' : 'taken from the supplier’s share'})`} checked={useDefaultFee} onChange={(e) => setUseDefaultFee(e.currentTarget.checked)} />
          {!useDefaultFee ? (
            <SegmentedControl
              value={feeMode}
              onChange={setFeeMode}
              data={[
                { value: 'exhibitor_pays', label: 'Exhibitor pays it on top' },
                { value: 'deduct_from_supplier', label: 'Taken from the supplier’s share' },
              ]}
            />
          ) : null}
          <Alert color="yellow" variant="light">
            UK rules ban card surcharges on consumer cards. Agree with finance before adding the fee on top.
          </Alert>
          <Text fw={600} mt="sm">
            Default Media10 commission for this edition
          </Text>
          <Switch
            label={`Use the platform default (${commissionLabel(platformCommission.type, platformCommission.value)})`}
            checked={useDefaultCommission}
            onChange={(e) => setUseDefaultCommission(e.currentTarget.checked)}
          />
          {!useDefaultCommission ? (
            <Group align="flex-end">
              <SegmentedControl value={type} onChange={(v) => setType(v as 'percent' | 'fixed')} data={[{ value: 'percent', label: 'Percentage' }, { value: 'fixed', label: 'Fixed per line' }]} />
              {type === 'percent' ? (
                <NumberInput label="Percent" value={value / 100} onChange={(v) => setValue(Math.round(Number(v || 0) * 100))} min={0} max={100} decimalScale={2} suffix="%" w={140} />
              ) : (
                <NumberInput label="Amount" value={value / 100} onChange={(v) => setValue(Math.round(Number(v || 0) * 100))} min={0} decimalScale={2} prefix="£" w={140} />
              )}
              <Text fz="sm" c="dimmed">
                {type === 'percent' ? `= ${percentFromBps(value)}` : null}
              </Text>
            </Group>
          ) : null}
          <Text fz="xs" c="dimmed">
            Suppliers, categories and individual products can override this.
          </Text>
          <Group>
            <Button type="submit" loading={save.pending}>
              Save fees and commission
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  );
}

function CloneForm({ edition }: { edition: EditionProps }) {
  const nextName = edition.name.replace(/(\d{4})/, (y) => String(Number(y) + 1));
  const [f, setF] = useState({ name: nextName === edition.name ? `${edition.name} (copy)` : nextName, buildUpStartsAt: null as string | null, openStartsAt: null as string | null, openEndsAt: null as string | null, breakdownEndsAt: null as string | null, copyStaff: true });
  const clone = useAction(cloneEditionAction);
  return (
    <Paper withBorder p="lg">
      <form onSubmit={(e) => { e.preventDefault(); clone.run(edition.id, f); }}>
        <Stack>
          <Text fz="sm">
            Copies manual pages, tasks and forms, exhibitor types, halls, services and prices, suppliers, email templates and the team. Never exhibitors, stands, submissions or orders.
          </Text>
          <TextInput label="New edition name" required value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} />
          <Group grow>
            <DateTimePicker label="Build-up starts" value={f.buildUpStartsAt} onChange={(v) => setF({ ...f, buildUpStartsAt: v })} clearable />
            <DateTimePicker label="Show opens" value={f.openStartsAt} onChange={(v) => setF({ ...f, openStartsAt: v })} clearable />
          </Group>
          <Group grow>
            <DateTimePicker label="Show closes" value={f.openEndsAt} onChange={(v) => setF({ ...f, openEndsAt: v })} clearable />
            <DateTimePicker label="Breakdown ends" value={f.breakdownEndsAt} onChange={(v) => setF({ ...f, breakdownEndsAt: v })} clearable />
          </Group>
          <Checkbox label="Copy the show team" checked={f.copyStaff} onChange={(e) => setF({ ...f, copyStaff: e.currentTarget.checked })} />
          <Group>
            <Button type="submit" loading={clone.pending}>
              Create the new edition
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  );
}

function DeletePanel({ edition }: { edition: EditionProps }) {
  const [confirm, setConfirm] = useState('');
  const del = useAction(deleteEditionAction);
  return (
    <Paper withBorder p="lg">
      <Stack>
        <Alert color="red" title="Delete this edition">
          Deleting removes the edition and everything in it. Editions with orders cannot be deleted; set the status to Archived instead.
        </Alert>
        <TextInput label={`Type ${edition.name} to confirm`} value={confirm} onChange={(e) => setConfirm(e.currentTarget.value)} />
        <Group>
          <Button
            color="red"
            disabled={confirm !== edition.name}
            loading={del.pending}
            onClick={() =>
              modals.openConfirmModal({
                title: 'Delete for good?',
                children: <Text fz="sm">This cannot be undone.</Text>,
                labels: { confirm: 'Delete edition', cancel: 'Cancel' },
                confirmProps: { color: 'red' },
                onConfirm: () => del.run(edition.id, confirm),
              })
            }
          >
            Delete edition
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

