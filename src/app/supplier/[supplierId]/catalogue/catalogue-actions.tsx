'use client';

import { Button, Group, Text } from '@mantine/core';
import { modals } from '@mantine/modals';
import { useAction } from '@/lib/use-action';
import { submitSupplierProductAction, withdrawSupplierProductAction } from '../../actions';

export function SupplierProductActions({ supplierId, productId, name, status }: { supplierId: string; productId: string; name: string; status: string }) {
  const submit = useAction(submitSupplierProductAction);
  const withdraw = useAction(withdrawSupplierProductAction);
  return (
    <Group gap="xs" justify="flex-end" wrap="nowrap">
      {status === 'draft' || status === 'rejected' ? (
        <Button size="xs" variant="light" loading={submit.pending} onClick={() => submit.run(supplierId, productId)} aria-label={`Send ${name} for approval`}>
          Send for approval
        </Button>
      ) : null}
      {status !== 'archived' ? (
        <Button
          size="xs"
          variant="subtle"
          color="red"
          loading={withdraw.pending}
          onClick={() =>
            modals.openConfirmModal({
              title: `Withdraw “${name}”?`,
              children: <Text fz="sm">It comes off sale straight away. Orders already placed are not affected.</Text>,
              labels: { confirm: 'Withdraw', cancel: 'Cancel' },
              confirmProps: { color: 'red' },
              onConfirm: () => withdraw.run(supplierId, productId),
            })
          }
        >
          Withdraw
        </Button>
      ) : null}
    </Group>
  );
}
