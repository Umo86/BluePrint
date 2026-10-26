'use client';

import { useState } from 'react';
import { Button, Group, Modal, NumberInput, Stack, Table, Text, Textarea, TextInput } from '@mantine/core';
import { useAction } from '@/lib/use-action';
import { money } from '@/lib/format';
import { cancelOrderAction, markInvoicePaidAction, refundOrderAction, retryTransferAction, settleManualTransferAction } from '../../../shop-actions';

type RefundLine = { id: string; description: string; refundablePence: number };

export function RefundButton({ orderId, lines, cardFeeRefundable, viaCard }: { orderId: string; lines: RefundLine[]; cardFeeRefundable: number; viaCard: boolean }) {
  const [open, setOpen] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [fee, setFee] = useState(0);
  const [reason, setReason] = useState('');
  const act = useAction(refundOrderAction, {
    onSuccess: () => {
      setOpen(false);
      setAmounts({});
      setFee(0);
      setReason('');
    },
  });
  const total = Object.values(amounts).reduce((a, b) => a + b, 0) + fee;
  const all = () => {
    setAmounts(Object.fromEntries(lines.map((l) => [l.id, l.refundablePence])));
    setFee(cardFeeRefundable);
  };
  return (
    <>
      <Button variant="default" onClick={() => setOpen(true)} disabled={!lines.some((l) => l.refundablePence > 0) && cardFeeRefundable <= 0}>
        Refund
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title="Refund" size="lg">
        <Stack>
          <Text fz="sm" c="dimmed">
            {viaCard
              ? 'The money goes back to the card used. Each supplier’s payout is taken back in proportion to what is refunded on their lines.'
              : 'This issues a credit note. Finance settles it with the exhibitor (and with any supplier already paid).'}
          </Text>
          <Table>
            <Table.Tbody>
              {lines.map((l) => (
                <Table.Tr key={l.id}>
                  <Table.Td>
                    <Text fz="sm">{l.description}</Text>
                    <Text fz="xs" c="dimmed">
                      Up to {money(l.refundablePence)}
                    </Text>
                  </Table.Td>
                  <Table.Td w={170}>
                    <NumberInput
                      aria-label={`Refund for ${l.description}`}
                      prefix="£"
                      decimalScale={2}
                      fixedDecimalScale
                      min={0}
                      max={l.refundablePence / 100}
                      value={(amounts[l.id] ?? 0) / 100}
                      onChange={(v) => setAmounts({ ...amounts, [l.id]: Math.min(l.refundablePence, Math.round(Number(v || 0) * 100)) })}
                      disabled={l.refundablePence <= 0}
                    />
                  </Table.Td>
                </Table.Tr>
              ))}
              {cardFeeRefundable > 0 ? (
                <Table.Tr>
                  <Table.Td>
                    <Text fz="sm">Card processing fee</Text>
                    <Text fz="xs" c="dimmed">
                      Up to {money(cardFeeRefundable)}. Stripe does not return its own fee.
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <NumberInput
                      aria-label="Card fee refund"
                      prefix="£"
                      decimalScale={2}
                      fixedDecimalScale
                      min={0}
                      max={cardFeeRefundable / 100}
                      value={fee / 100}
                      onChange={(v) => setFee(Math.min(cardFeeRefundable, Math.round(Number(v || 0) * 100)))}
                    />
                  </Table.Td>
                </Table.Tr>
              ) : null}
            </Table.Tbody>
          </Table>
          <Group justify="space-between">
            <Button variant="subtle" size="xs" onClick={all}>
              Refund everything left
            </Button>
            <Text fw={600}>Total {money(total)}</Text>
          </Group>
          <Textarea label="Reason" description="Printed on the credit note and sent to the exhibitor." value={reason} onChange={(e) => setReason(e.currentTarget.value)} maxLength={500} autosize minRows={2} required />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              color="red"
              loading={act.pending}
              disabled={total <= 0 || reason.trim().length < 3}
              onClick={() =>
                act.run(orderId, {
                  lines: Object.entries(amounts)
                    .filter(([, a]) => a > 0)
                    .map(([lineId, amountPence]) => ({ lineId, amountPence })),
                  cardFeePence: fee,
                  reason,
                })
              }
            >
              Refund {money(total)}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

function ReasonButton({
  label,
  title,
  field,
  description,
  confirmLabel,
  color,
  onRun,
  pending,
}: {
  label: string;
  title: string;
  field: string;
  description: string;
  confirmLabel: string;
  color?: string;
  onRun: (value: string) => Promise<{ ok: boolean }>;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  return (
    <>
      <Button variant="default" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title={title}>
        <Stack>
          <Text fz="sm" c="dimmed">
            {description}
          </Text>
          <TextInput label={field} value={value} onChange={(e) => setValue(e.currentTarget.value)} maxLength={300} data-autofocus />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setOpen(false)}>
              Back
            </Button>
            <Button
              color={color}
              loading={pending}
              disabled={value.trim().length < 2}
              onClick={async () => {
                const r = await onRun(value);
                if (r.ok) setOpen(false);
              }}
            >
              {confirmLabel}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

export function CancelOrderButton({ orderId, invoiced }: { orderId: string; invoiced: boolean }) {
  const act = useAction(cancelOrderAction);
  return (
    <ReasonButton
      label="Cancel order"
      title="Cancel this order"
      field="Reason"
      description={invoiced ? 'A credit note for the full amount is issued and the exhibitor and suppliers are told.' : 'The card payment page is closed so it can no longer be paid.'}
      confirmLabel="Cancel order"
      color="red"
      pending={act.pending}
      onRun={(v) => act.run(orderId, v)}
    />
  );
}

export function MarkPaidButton({ orderId }: { orderId: string }) {
  const act = useAction(markInvoicePaidAction);
  return (
    <ReasonButton
      label="Mark as paid"
      title="Record payment received"
      field="Payment reference"
      description="Use the reference from the bank statement. Supplier payouts for this order are then listed for finance to pay."
      confirmLabel="Mark as paid"
      pending={act.pending}
      onRun={(v) => act.run(orderId, v)}
    />
  );
}

export function SettleTransferButton({ transferId }: { transferId: string }) {
  const act = useAction(settleManualTransferAction);
  return (
    <ReasonButton
      label="Record payout"
      title="Record that the supplier has been paid"
      field="Payment reference"
      description="For payouts finance makes by bank transfer."
      confirmLabel="Record"
      pending={act.pending}
      onRun={(v) => act.run(transferId, v)}
    />
  );
}

export function RetryTransferButton({ transferId }: { transferId: string }) {
  const act = useAction(retryTransferAction, { successMessage: 'Tried again. Check the payout status.' });
  return (
    <Button size="xs" variant="light" loading={act.pending} onClick={() => act.run(transferId)}>
      Try again
    </Button>
  );
}
