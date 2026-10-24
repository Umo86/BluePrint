'use client';

import { useState } from 'react';
import { ActionIcon, Button, Group, Menu, Modal, MultiSelect, NumberInput, SegmentedControl, Select, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconArrowDown, IconArrowUp, IconDots, IconPencil, IconTrash } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import {
  createCategoryAction,
  deleteCategoryAction,
  deleteProductAction,
  moveCategoryAction,
  moveProductAction,
  setProductStatusAction,
  updateCategoryAction,
} from '../../shop-actions';

export type CategoryValues = {
  id?: string;
  name: string;
  description: string;
  supplierId: string | null;
  orderByOffsetDays: number | null;
  visibleToTypes: string[];
  commissionType: 'percent' | 'fixed' | null;
  commissionValue: number | null;
};

const EMPTY: CategoryValues = { name: '', description: '', supplierId: null, orderByOffsetDays: null, visibleToTypes: [], commissionType: null, commissionValue: null };

/** Adds a category, or edits one (pass `initial`). */
export function CategoryButton({
  editionId,
  initial,
  suppliers,
  types,
  canSetCommission,
  label = 'Add a category',
}: {
  editionId: string;
  initial?: CategoryValues;
  suppliers: { value: string; label: string }[];
  types: { value: string; label: string }[];
  canSetCommission: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<CategoryValues>(initial ?? EMPTY);
  const create = useAction(createCategoryAction, { onSuccess: () => setOpen(false) });
  const update = useAction(updateCategoryAction, { onSuccess: () => setOpen(false) });
  const errors = { ...create.fieldErrors, ...update.fieldErrors };
  const submit = () => {
    const input = {
      name: v.name,
      description: v.description || null,
      supplierId: v.supplierId,
      orderByOffsetDays: v.orderByOffsetDays,
      visibleToTypes: v.visibleToTypes,
      commissionType: v.commissionType,
      commissionValue: v.commissionType ? v.commissionValue ?? 0 : null,
    };
    if (initial?.id) update.run(initial.id, input);
    else create.run(editionId, input);
  };
  return (
    <>
      {initial ? (
        <ActionIcon variant="subtle" aria-label={`Edit ${initial.name}`} onClick={() => setOpen(true)}>
          <IconPencil size={16} />
        </ActionIcon>
      ) : (
        <Button
          variant="default"
          onClick={() => {
            setV(EMPTY);
            setOpen(true);
          }}
        >
          {label}
        </Button>
      )}
      <Modal opened={open} onClose={() => setOpen(false)} title={initial ? `Edit ${initial.name}` : 'Add a category'} size="lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Stack>
            <TextInput label="Name" value={v.name} onChange={(e) => setV({ ...v, name: e.currentTarget.value })} error={errors.name} required data-autofocus maxLength={120} />
            <Textarea label="Description" value={v.description} onChange={(e) => setV({ ...v, description: e.currentTarget.value })} autosize minRows={2} maxLength={2000} />
            <Select
              label="Supplied by"
              description="Orders in this category go to this supplier, who is paid through Stripe. Leave empty if Media10 provides it."
              data={suppliers}
              value={v.supplierId}
              onChange={(x) => setV({ ...v, supplierId: x })}
              clearable
              searchable
              placeholder="Media10"
            />
            <NumberInput
              label="Order by (days before build-up)"
              description="Shown to exhibitors as the date to order by. Leave empty for none."
              min={0}
              max={365}
              value={v.orderByOffsetDays ?? ''}
              onChange={(x) => setV({ ...v, orderByOffsetDays: x === '' ? null : Number(x) })}
              w={260}
            />
            <MultiSelect label="Shown to" description="Leave empty to show it to every stand type." data={types} value={v.visibleToTypes} onChange={(x) => setV({ ...v, visibleToTypes: x })} clearable />
            {canSetCommission ? (
              <Stack gap={6}>
                <Text fz="sm" fw={500}>
                  Commission
                </Text>
                <SegmentedControl
                  value={v.commissionType ?? 'default'}
                  onChange={(x) => setV({ ...v, commissionType: x === 'default' ? null : (x as 'percent' | 'fixed'), commissionValue: x === 'default' ? null : v.commissionValue ?? 0 })}
                  data={[
                    { value: 'default', label: 'Supplier or show default' },
                    { value: 'percent', label: 'Percentage' },
                    { value: 'fixed', label: 'Fixed per line' },
                  ]}
                />
                {v.commissionType === 'percent' ? (
                  <NumberInput label="Percent" suffix="%" decimalScale={2} min={0} max={100} value={(v.commissionValue ?? 0) / 100} onChange={(x) => setV({ ...v, commissionValue: Math.round(Number(x || 0) * 100) })} w={160} error={errors.commissionValue} />
                ) : v.commissionType === 'fixed' ? (
                  <NumberInput label="Amount" prefix="£" decimalScale={2} min={0} value={(v.commissionValue ?? 0) / 100} onChange={(x) => setV({ ...v, commissionValue: Math.round(Number(x || 0) * 100) })} w={160} error={errors.commissionValue} />
                ) : null}
              </Stack>
            ) : null}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={create.pending || update.pending}>
                Save
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
}

export function CategoryRowActions({ categoryId, name }: { categoryId: string; name: string }) {
  const move = useAction(moveCategoryAction);
  const del = useAction(deleteCategoryAction);
  return (
    <Group gap={2} wrap="nowrap">
      <ActionIcon variant="subtle" aria-label={`Move ${name} up`} onClick={() => move.run(categoryId, 'up')}>
        <IconArrowUp size={16} />
      </ActionIcon>
      <ActionIcon variant="subtle" aria-label={`Move ${name} down`} onClick={() => move.run(categoryId, 'down')}>
        <IconArrowDown size={16} />
      </ActionIcon>
      <ActionIcon
        variant="subtle"
        color="red"
        aria-label={`Delete ${name}`}
        onClick={() =>
          modals.openConfirmModal({
            title: `Delete “${name}”?`,
            children: <Text fz="sm">Its products are deleted too. Categories that have been ordered from cannot be deleted.</Text>,
            labels: { confirm: 'Delete', cancel: 'Cancel' },
            confirmProps: { color: 'red' },
            onConfirm: () => del.run(categoryId),
          })
        }
      >
        <IconTrash size={16} />
      </ActionIcon>
    </Group>
  );
}

export function ProductRowActions({ productId, name, status }: { productId: string; name: string; status: string }) {
  const move = useAction(moveProductAction);
  const setStatus = useAction(setProductStatusAction);
  const del = useAction(deleteProductAction);
  return (
    <Group gap={2} wrap="nowrap" justify="flex-end">
      <ActionIcon variant="subtle" aria-label={`Move ${name} up`} onClick={() => move.run(productId, 'up')}>
        <IconArrowUp size={16} />
      </ActionIcon>
      <ActionIcon variant="subtle" aria-label={`Move ${name} down`} onClick={() => move.run(productId, 'down')}>
        <IconArrowDown size={16} />
      </ActionIcon>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon variant="subtle" aria-label={`More for ${name}`}>
            <IconDots size={16} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          {status !== 'approved' ? <Menu.Item onClick={() => setStatus.run(productId, 'approved', null)}>Put on sale</Menu.Item> : null}
          {status === 'approved' ? <Menu.Item onClick={() => setStatus.run(productId, 'archived', null)}>Take off sale</Menu.Item> : null}
          {status !== 'draft' && status !== 'approved' ? <Menu.Item onClick={() => setStatus.run(productId, 'draft', null)}>Move back to draft</Menu.Item> : null}
          <Menu.Item
            color="red"
            onClick={() =>
              modals.openConfirmModal({
                title: `Delete “${name}”?`,
                children: <Text fz="sm">Products that have been ordered cannot be deleted; take them off sale instead.</Text>,
                labels: { confirm: 'Delete', cancel: 'Cancel' },
                confirmProps: { color: 'red' },
                onConfirm: () => del.run(productId),
              })
            }
          >
            Delete
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}

/** Approve a supplier's product, or send it back with a note. */
export function ApprovalButtons({ productId, name }: { productId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const act = useAction(setProductStatusAction, { onSuccess: () => setOpen(false) });
  return (
    <Group gap="xs" wrap="nowrap">
      <Button size="xs" loading={act.pending && !open} onClick={() => act.run(productId, 'approved', null)} aria-label={`Approve ${name}`}>
        Approve
      </Button>
      <Button size="xs" variant="default" onClick={() => setOpen(true)} aria-label={`Send back ${name}`}>
        Send back
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title={`Send back “${name}”`}>
        <Stack>
          <Textarea label="What needs changing?" description="The supplier sees this." value={reason} onChange={(e) => setReason(e.currentTarget.value)} autosize minRows={3} maxLength={1000} data-autofocus />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={act.pending} disabled={!reason.trim()} onClick={() => act.run(productId, 'rejected', reason)}>
              Send back
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Group>
  );
}
