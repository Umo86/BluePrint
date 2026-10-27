'use client';

import { Button, Group, Text } from '@mantine/core';
import { modals } from '@mantine/modals';
import { useAction } from '@/lib/use-action';
import { deleteSupplierProductAction, submitSupplierProductAction, withdrawSupplierProductAction } from '../../actions';

export function SupplierProductActions({ supplierId, productId, name, status, sold = 0 }: { supplierId: string; productId: string; name: string; status: string; sold?: number }) {
  const submit = useAction(submitSupplierProductAction);
  const withdraw = useAction(withdrawSupplierProductAction);
  const remove = useAction(deleteSupplierProductAction);
  const draft = status === 'draft' || status === 'rejected';
  return (
    <Group gap="xs" justify="flex-end" wrap="nowrap">
      {draft ? (
        <Button size="xs" variant="light" loading={submit.pending} onClick={() => submit.run(supplierId, productId)} aria-label={`Send ${name} for approval`}>
          Send for approval
        </Button>
      ) : null}
      {status === 'approved' || status === 'pending_approval' ? (
        <Button
          size="xs"
          variant="subtle"
          color="red"
          loading={withdraw.pending}
          onClick={() =>
            modals.openConfirmModal({
              title: `Withdraw “${name}”?`,
              children: <Text fz="sm">It comes off sale straight away and goes back to your drafts, so you can change it and send it for approval again. Orders already placed are not affected.</Text>,
              labels: { confirm: 'Withdraw', cancel: 'Cancel' },
              confirmProps: { color: 'red' },
              onConfirm: () => withdraw.run(supplierId, productId),
            })
          }
        >
          Withdraw
        </Button>
      ) : null}
      {draft && !sold ? (
        <Button
          size="xs"
          variant="subtle"
          color="red"
          loading={remove.pending}
          aria-label={`Delete ${name}`}
          onClick={() =>
            modals.openConfirmModal({
              title: `Delete “${name}”?`,
              children: <Text fz="sm">It has never been ordered, so it is removed for good.</Text>,
              labels: { confirm: 'Delete', cancel: 'Cancel' },
              confirmProps: { color: 'red' },
              onConfirm: () => remove.run(supplierId, productId),
            })
          }
        >
          Delete
        </Button>
      ) : null}
    </Group>
  );
}
