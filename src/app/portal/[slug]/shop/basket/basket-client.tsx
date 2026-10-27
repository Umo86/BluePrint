'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionIcon, Alert, Badge, Button, Checkbox, Divider, Group, Image, NumberInput, Paper, ScrollArea, SegmentedControl, Stack, Table, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconLock, IconTrash } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import { money } from '@/lib/format';
import { isAllowedPaymentRedirect } from '@/lib/safe-redirect';
import { checkoutAction, removeBasketItemAction, updateBasketItemAction } from '../../../shop-actions';
import { OrderLineDetails } from '@/components/order-line-details';

type Item = {
  itemId: string;
  name: string;
  code: string | null;
  unit: string;
  imageUrl: string | null;
  options: Record<string, string>;
  details: Record<string, unknown>;
  quantity: number;
  unitPence: number;
  band: string;
  stockLeft: number | null;
  problem: 'unavailable' | 'stock' | null;
  netPence: number;
  vatPence: number;
};
type Totals = { netPence: number; vatPence: number; cardFeePence: number; totalPence: number };

export function BasketClient({
  slug,
  standId,
  items,
  card,
  invoice,
  canPay,
  editable,
  terms,
  feeMode,
  practice = false,
}: {
  slug: string;
  standId: string;
  items: Item[];
  card: Totals | null;
  invoice: Totals | null;
  canPay: boolean;
  editable: boolean;
  terms: string;
  feeMode: string;
  practice?: boolean;
}) {
  const router = useRouter();
  const [method, setMethod] = useState<'card' | 'invoice'>(card ? 'card' : 'invoice');
  const [po, setPo] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const update = useAction(updateBasketItemAction);
  const remove = useAction(removeBasketItemAction);
  const pay = useAction(checkoutAction, {
    onSuccess: (data) => {
      if (!data) return;
      if (data.redirectUrl) {
        if (!isAllowedPaymentRedirect(data.redirectUrl)) {
          notifications.show({ color: 'red', message: 'The payment page address looked wrong, so we stopped. Please contact the show team.' });
          return;
        }
        setLeaving(true);
        window.location.assign(data.redirectUrl);
        return;
      }
      router.push(`/portal/${slug}/orders/${data.orderId}?placed=1`);
    },
  });
  const totals = method === 'card' ? card : invoice;
  const problems = items.some((i) => i.problem);
  const free = totals?.totalPence === 0;

  if (!items.length) return null;
  return (
    <Stack>
      <Paper withBorder>
        <ScrollArea>
          <Table verticalSpacing="sm" miw={640}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Item</Table.Th>
                <Table.Th w={130}>Quantity</Table.Th>
                <Table.Th ta="right">Price</Table.Th>
                <Table.Th ta="right">Total (before VAT)</Table.Th>
                <Table.Th w={50} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((i) => (
                <Table.Tr key={i.itemId} bg={i.problem ? 'var(--mantine-color-red-0)' : undefined}>
                  <Table.Td>
                    <Group gap="sm" wrap="nowrap">
                      {i.imageUrl ? <Image src={i.imageUrl} alt="" w={48} h={40} fit="contain" radius="sm" /> : null}
                      <div>
                        <Text fz="sm" fw={600}>
                          {i.name}
                        </Text>
                        {i.code ? (
                          <Text fz="xs" c="dimmed">
                            Code {i.code}
                          </Text>
                        ) : null}
                        {Object.keys(i.options).length ? (
                          <Text fz="xs" c="dimmed">
                            {Object.entries(i.options)
                              .map(([k, v]) => `${k}: ${v}`)
                              .join(' · ')}
                          </Text>
                        ) : null}
                        <OrderLineDetails details={i.details} />
                        {i.problem === 'unavailable' ? (
                          <Text fz="xs" c="red">
                            No longer available. Please remove it.
                          </Text>
                        ) : i.problem === 'stock' ? (
                          <Text fz="xs" c="red">
                            Only {i.stockLeft} left. Please lower the quantity.
                          </Text>
                        ) : null}
                        {i.band === 'early' ? (
                          <Badge size="xs" color="green" variant="light">
                            Early-bird price
                          </Badge>
                        ) : i.band === 'late' ? (
                          <Badge size="xs" color="orange" variant="light">
                            Late price
                          </Badge>
                        ) : null}
                      </div>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <NumberInput
                      key={`${i.itemId}-${i.quantity}`}
                      aria-label={`Quantity of ${i.name}`}
                      size="xs"
                      min={1}
                      max={999}
                      defaultValue={i.quantity}
                      allowDecimal={false}
                      disabled={!editable || update.pending}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
                      onBlur={(e) => {
                        const n = Number.parseInt(e.currentTarget.value, 10);
                        if (Number.isFinite(n) && n !== i.quantity && n >= 1) update.run(slug, standId, i.itemId, Math.min(999, n));
                      }}
                      w={100}
                    />
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text fz="sm">{money(i.unitPence)}</Text>
                    {i.unit !== 'each' ? (
                      <Text fz="xs" c="dimmed">
                        {i.unit}
                      </Text>
                    ) : null}
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text fz="sm" fw={600}>
                      {i.problem ? '—' : money(i.netPence)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <ActionIcon variant="subtle" color="red" aria-label={`Remove ${i.name}`} disabled={!editable} loading={remove.pending} onClick={() => remove.run(slug, standId, i.itemId)}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Paper>

      <Paper withBorder p="md" maw={520} ml="auto" w="100%">
        <Stack>
          {card && invoice ? (
            <SegmentedControl
              value={method}
              onChange={(v) => setMethod(v as 'card' | 'invoice')}
              data={[
                { value: 'card', label: 'Pay by card' },
                { value: 'invoice', label: 'Pay on invoice' },
              ]}
              fullWidth
            />
          ) : null}
          {totals ? (
            <Stack gap={4}>
              <Group justify="space-between">
                <Text fz="sm">Total before VAT</Text>
                <Text fz="sm">{money(totals.netPence)}</Text>
              </Group>
              <Group justify="space-between">
                <Text fz="sm">VAT</Text>
                <Text fz="sm">{money(totals.vatPence)}</Text>
              </Group>
              {totals.cardFeePence ? (
                <Group justify="space-between">
                  <Text fz="sm">Card processing fee</Text>
                  <Text fz="sm">{money(totals.cardFeePence)}</Text>
                </Group>
              ) : null}
              <Divider my={4} />
              <Group justify="space-between">
                <Text fw={700}>To pay</Text>
                <Text fw={700} fz="lg">
                  {money(totals.totalPence)}
                </Text>
              </Group>
              {method === 'card' && feeMode === 'exhibitor_pays' && totals.cardFeePence ? (
                <Text fz="xs" c="dimmed">
                  The card fee covers the bank’s charge for card payments. Paying on invoice avoids it, if your company has an account.
                </Text>
              ) : null}
              {method === 'invoice' ? (
                <Text fz="xs" c="dimmed">
                  We will email you a VAT invoice. Your order is confirmed straight away.
                </Text>
              ) : null}
            </Stack>
          ) : (
            <Alert color="yellow">Card payments are not available at the moment. Please contact the show team to order.</Alert>
          )}
          <TextInput label="Your purchase order number (optional)" value={po} onChange={(e) => setPo(e.currentTarget.value)} maxLength={60} />
          {terms ? (
            <Stack gap={4}>
              <ScrollArea.Autosize mah={140} type="auto">
                <Text fz="xs" c="dimmed" style={{ whiteSpace: 'pre-line' }}>
                  {terms}
                </Text>
              </ScrollArea.Autosize>
              <Checkbox label="I accept these terms" checked={accepted} onChange={(e) => setAccepted(e.currentTarget.checked)} error={pay.fieldErrors.acceptTerms} />
            </Stack>
          ) : null}
          {!canPay ? <Alert color="blue">You can build the basket, but your company has not given you permission to pay. Ask your main contact to place the order.</Alert> : null}
          {problems ? <Alert color="red">Please fix the items marked in red before paying.</Alert> : null}
          <Button
            size="md"
            leftSection={method === 'card' && !free ? <IconLock size={16} /> : null}
            disabled={!totals || !canPay || !editable || problems || (Boolean(terms) && !accepted)}
            loading={pay.pending || leaving}
            onClick={() => pay.run(slug, standId, { method, poNumber: po || null, acceptTerms: accepted, expectedTotalPence: totals!.totalPence })}
          >
            {free ? 'Place order' : method === 'card' ? `Pay ${money(totals?.totalPence ?? 0)} securely` : `Place order on invoice (${money(totals?.totalPence ?? 0)})`}
          </Button>
          {method === 'card' && !free ? (
            <Text fz="xs" c="dimmed" ta="center">
              {practice ? 'This is a demo show: you go to a practice payment page, and no card is charged.' : 'You will pay on Stripe’s secure page. BluePrint never sees your card details.'}
            </Text>
          ) : null}
        </Stack>
      </Paper>
    </Stack>
  );
}
