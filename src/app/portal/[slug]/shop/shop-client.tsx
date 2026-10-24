'use client';

import { useState } from 'react';
import { Button, Group, Modal, NumberInput, Select, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { IconShoppingCartPlus } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import { money } from '@/lib/format';
import { addToBasketAction } from '../../shop-actions';

type Product = {
  id: string;
  name: string;
  unit: string;
  unitPence: number;
  vatRateBps: number;
  options: { name: string; values: string[] }[];
  requiredDetails: { id: string; label: string; type: string; required?: boolean }[];
  stockLeft: number | null;
};

/** Choose options, answer the supplier's questions, pick a quantity and add to the basket. */
export function AddToBasketButton({ slug, standId, product, disabled }: { slug: string; standId: string; product: Product; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(1);
  const [options, setOptions] = useState<Record<string, string>>({});
  const [details, setDetails] = useState<Record<string, string>>({});
  const add = useAction(addToBasketAction, {
    onSuccess: () => {
      setOpen(false);
      setQty(1);
      setOptions({});
      setDetails({});
    },
  });
  const soldOut = product.stockLeft !== null && product.stockLeft <= 0;
  const simple = !product.options.length && !product.requiredDetails.length;
  const gross = (product.unitPence + Math.round((product.unitPence * product.vatRateBps) / 10_000)) * qty;
  const submit = () => add.run(slug, standId, { productId: product.id, quantity: qty, options, details });
  return (
    <>
      <Button
        leftSection={<IconShoppingCartPlus size={16} />}
        size="sm"
        disabled={disabled || soldOut}
        onClick={() => setOpen(true)}
        aria-label={`Add ${product.name} to basket`}
      >
        {soldOut ? 'Sold out' : 'Add'}
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title={product.name}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Stack>
            {product.options.map((o) => (
              <Select
                key={o.name}
                label={o.name}
                data={o.values}
                value={options[o.name] ?? null}
                onChange={(v) => setOptions({ ...options, [o.name]: v ?? '' })}
                error={add.fieldErrors[`options.${o.name}`]}
                required
                allowDeselect={false}
                comboboxProps={{ withinPortal: true }}
              />
            ))}
            {product.requiredDetails.map((q) =>
              q.type === 'textarea' ? (
                <Textarea
                  key={q.id}
                  label={q.label}
                  value={details[q.id] ?? ''}
                  onChange={(e) => setDetails({ ...details, [q.id]: e.currentTarget.value })}
                  required={q.required}
                  error={add.fieldErrors[`details.${q.id}`]}
                  autosize
                  minRows={2}
                  maxLength={2000}
                />
              ) : (
                <TextInput
                  key={q.id}
                  label={q.label}
                  value={details[q.id] ?? ''}
                  onChange={(e) => setDetails({ ...details, [q.id]: e.currentTarget.value })}
                  required={q.required}
                  error={add.fieldErrors[`details.${q.id}`]}
                  maxLength={300}
                />
              ),
            )}
            <NumberInput
              label={`Quantity${product.unit !== 'each' ? ` (${product.unit})` : ''}`}
              min={1}
              max={product.stockLeft ?? 999}
              value={qty}
              onChange={(v) => setQty(Math.max(1, Math.min(999, Number(v || 1))))}
              w={160}
              data-autofocus={simple ? true : undefined}
            />
            {product.stockLeft !== null ? (
              <Text fz="xs" c="dimmed">
                {product.stockLeft} left
              </Text>
            ) : null}
            <Group justify="space-between">
              <Text fz="sm">
                {money(product.unitPence * qty)} + VAT ({money(gross)} in total)
              </Text>
              <Button type="submit" loading={add.pending}>
                Add to basket
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
}
