'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ActionIcon,
  Alert,
  Button,
  Checkbox,
  Divider,
  Group,
  Image,
  MultiSelect,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  TagsInput,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import { money } from '@/lib/format';
import { FileUpload } from '@/components/file-upload';
import type { ProductFormValues } from '@/lib/product-defaults';
import { createProductAction, updateProductAction } from '@/app/manage/shop-actions';
import { createSupplierProductAction, updateSupplierProductAction } from '@/app/supplier/actions';

export type { ProductFormValues };

type Mode =
  | { kind: 'staff'; editionId: string; productId?: string; canSetCommission: boolean; types: { value: string; label: string }[]; afterSaveHref: string }
  | { kind: 'supplier'; supplierId: string; productId?: string; editionIdFor: Record<string, string>; afterSaveHref: string };

const toPence = (v: string | number) => (v === '' || v === null || v === undefined ? 0 : Math.round(Number(v) * 100));
const slugId = (label: string, taken: string[]) => {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 30) || 'question';
  let id = base;
  for (let i = 2; taken.includes(id); i++) id = `${base}_${i}`;
  return id;
};

/** Adds or edits a shop product. The same form serves the show team and suppliers (who cannot set commission or visibility). */
export function ProductForm({
  mode,
  initial,
  categories,
  status,
  rejectionReason,
}: {
  mode: Mode;
  initial: ProductFormValues;
  categories: { value: string; label: string }[];
  status?: string;
  rejectionReason?: string | null;
}) {
  const router = useRouter();
  const [v, setV] = useState<ProductFormValues>(initial);
  const [early, setEarly] = useState(initial.earlyPricePence !== null);
  const [late, setLate] = useState(initial.latePricePence !== null);
  const [limited, setLimited] = useState(initial.stockLimit !== null);
  const set = <K extends keyof ProductFormValues>(k: K, value: ProductFormValues[K]) => setV((cur) => ({ ...cur, [k]: value }));
  const done = () => {
    router.push(mode.afterSaveHref);
    router.refresh();
  };
  const staffCreate = useAction(createProductAction, { onSuccess: done });
  const staffUpdate = useAction(updateProductAction, { onSuccess: () => router.refresh() });
  const supplierCreate = useAction(createSupplierProductAction, { onSuccess: done });
  const supplierUpdate = useAction(updateSupplierProductAction, { onSuccess: () => router.refresh() });
  const pending = staffCreate.pending || staffUpdate.pending || supplierCreate.pending || supplierUpdate.pending;
  const errors = { ...staffCreate.fieldErrors, ...staffUpdate.fieldErrors, ...supplierCreate.fieldErrors, ...supplierUpdate.fieldErrors };

  const payload = useMemo(() => {
    const base = {
      categoryId: v.categoryId,
      name: v.name,
      description: v.description || null,
      imageFileId: v.imageFileId,
      unit: v.unit || 'each',
      pricePence: v.pricePence,
      earlyPricePence: early ? v.earlyPricePence ?? 0 : null,
      earlyUntilOffsetDays: early ? v.earlyUntilOffsetDays ?? 0 : null,
      latePricePence: late ? v.latePricePence ?? 0 : null,
      lateFromOffsetDays: late ? v.lateFromOffsetDays ?? 0 : null,
      vatRateBps: v.vatRateBps,
      options: v.options.map((o) => ({ name: o.name.trim(), values: o.values })).filter((o) => o.name || o.values.length),
      requiredDetails: v.requiredDetails.filter((q) => q.label.trim()),
      stockLimit: limited ? v.stockLimit ?? 0 : null,
    };
    return base;
  }, [v, early, late, limited]);

  const save = (opts: { draft?: boolean; submit?: boolean } = {}) => {
    if (mode.kind === 'staff') {
      const input = { ...payload, visibleToTypes: v.visibleToTypes, commissionType: mode.canSetCommission ? v.commissionType : initial.commissionType, commissionValue: mode.canSetCommission ? v.commissionValue : initial.commissionValue };
      if (mode.productId) staffUpdate.run(mode.productId, input);
      else staffCreate.run(mode.editionId, input, Boolean(opts.draft));
    } else if (mode.productId) {
      supplierUpdate.run(mode.supplierId, mode.productId, payload, Boolean(opts.submit));
    } else {
      supplierCreate.run(mode.supplierId, payload, Boolean(opts.submit));
    }
  };

  const gross = v.pricePence + Math.round((v.pricePence * v.vatRateBps) / 10_000);
  const uploadScope = mode.kind === 'staff' ? { editionId: mode.editionId } : { supplierId: mode.supplierId, editionId: mode.editionIdFor[v.categoryId] };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Stack>
        {status === 'rejected' && rejectionReason ? (
          <Alert color="orange" title="The show team asked for changes">
            {rejectionReason}
          </Alert>
        ) : null}
        {mode.kind === 'supplier' && (status === 'approved' || status === 'pending_approval') ? (
          <Alert color="blue">Saving changes sends this product back to the show team for approval. It is not on sale until they approve it again.</Alert>
        ) : null}
        <Paper withBorder p="md">
          <Stack>
            <Title order={2} fz="md">
              Product
            </Title>
            <Select label="Category" data={categories} value={v.categoryId} onChange={(x) => x && set('categoryId', x)} allowDeselect={false} error={errors.categoryId} required />
            <TextInput label="Name" value={v.name} onChange={(e) => set('name', e.currentTarget.value)} maxLength={200} error={errors.name} required />
            <Textarea label="Description" description="What is included, sizes, delivery times." value={v.description} onChange={(e) => set('description', e.currentTarget.value)} autosize minRows={3} maxLength={4000} />
            <div>
              <Text fz="sm" fw={500} mb={4}>
                Photo
              </Text>
              {v.imageFileId ? (
                <Group align="flex-start">
                  <Image src={`/files/${v.imageFileId}`} alt="" w={140} h={100} fit="contain" radius="sm" bg="gray.0" />
                  <Button variant="subtle" color="red" size="xs" onClick={() => set('imageFileId', null)}>
                    Remove photo
                  </Button>
                </Group>
              ) : (
                <FileUpload purpose="product" scope={uploadScope} onUploaded={(f) => set('imageFileId', f.fileId)} label="Drop a photo here, or click to choose" />
              )}
            </div>
          </Stack>
        </Paper>

        <Paper withBorder p="md">
          <Stack>
            <Title order={2} fz="md">
              Price
            </Title>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <NumberInput label="Price (before VAT)" prefix="£" decimalScale={2} fixedDecimalScale min={0} value={v.pricePence / 100} onChange={(x) => set('pricePence', toPence(x))} error={errors.pricePence} required />
              <NumberInput label="VAT rate" suffix="%" decimalScale={2} min={0} max={100} value={v.vatRateBps / 100} onChange={(x) => set('vatRateBps', Math.round(Number(x || 0) * 100))} error={errors.vatRateBps} />
              <TextInput label="Sold per" description="For example: each, per day, per metre" value={v.unit} onChange={(e) => set('unit', e.currentTarget.value)} maxLength={40} />
            </SimpleGrid>
            <Text fz="sm" c="dimmed">
              Exhibitors pay {money(gross)} including VAT{v.unit && v.unit !== 'each' ? ` ${v.unit}` : ''}.
            </Text>
            <Switch label="Early-bird price" checked={early} onChange={(e) => setEarly(e.currentTarget.checked)} />
            {early ? (
              <Group>
                <NumberInput label="Early-bird price (before VAT)" prefix="£" decimalScale={2} fixedDecimalScale min={0} value={(v.earlyPricePence ?? 0) / 100} onChange={(x) => set('earlyPricePence', toPence(x))} w={220} />
                <NumberInput
                  label="Until (days before build-up)"
                  min={0}
                  max={365}
                  value={v.earlyUntilOffsetDays ?? 0}
                  onChange={(x) => set('earlyUntilOffsetDays', Number(x || 0))}
                  error={errors.earlyUntilOffsetDays}
                  w={220}
                />
              </Group>
            ) : null}
            <Switch label="Late-order price" checked={late} onChange={(e) => setLate(e.currentTarget.checked)} />
            {late ? (
              <Group>
                <NumberInput label="Late price (before VAT)" prefix="£" decimalScale={2} fixedDecimalScale min={0} value={(v.latePricePence ?? 0) / 100} onChange={(x) => set('latePricePence', toPence(x))} w={220} />
                <NumberInput
                  label="From (days before build-up)"
                  min={0}
                  max={365}
                  value={v.lateFromOffsetDays ?? 0}
                  onChange={(x) => set('lateFromOffsetDays', Number(x || 0))}
                  error={errors.lateFromOffsetDays}
                  w={220}
                />
              </Group>
            ) : null}
            <Switch label="Limited stock" checked={limited} onChange={(e) => setLimited(e.currentTarget.checked)} />
            {limited ? <NumberInput label="Total available for the show" min={0} max={1_000_000} value={v.stockLimit ?? 0} onChange={(x) => set('stockLimit', Number(x || 0))} w={220} /> : null}
          </Stack>
        </Paper>

        <Paper withBorder p="md">
          <Stack>
            <div>
              <Title order={2} fz="md">
                Choices and questions
              </Title>
              <Text fz="sm" c="dimmed">
                Options the exhibitor picks (such as colour), and anything you need to know to deliver it.
              </Text>
            </div>
            {v.options.map((o, i) => (
              <Group key={i} align="flex-end" wrap="nowrap">
                <TextInput
                  label="Option"
                  placeholder="Colour"
                  value={o.name}
                  onChange={(e) => {
                    const val = e.currentTarget.value;
                    set(
                      'options',
                      v.options.map((x, j) => (j === i ? { ...x, name: val } : x)),
                    );
                  }}
                  maxLength={60}
                  w={180}
                />
                <TagsInput
                  label="Choices"
                  placeholder="Type a choice and press Enter"
                  value={o.values}
                  onChange={(vals) =>
                    set(
                      'options',
                      v.options.map((x, j) => (j === i ? { ...x, values: vals.slice(0, 30) } : x)),
                    )
                  }
                  style={{ flex: 1 }}
                />
                <ActionIcon
                  variant="subtle"
                  color="red"
                  aria-label={`Remove option ${o.name || i + 1}`}
                  onClick={() =>
                    set(
                      'options',
                      v.options.filter((_, j) => j !== i),
                    )
                  }
                  mb={4}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
            ))}
            {errors.options ? (
              <Text c="red" fz="sm">
                {errors.options}
              </Text>
            ) : null}
            {v.options.length < 5 ? (
              <Group>
                <Button variant="light" size="xs" leftSection={<IconPlus size={14} />} onClick={() => set('options', [...v.options, { name: '', values: [] }])}>
                  Add an option
                </Button>
              </Group>
            ) : null}
            <Divider />
            {v.requiredDetails.map((q, i) => (
              <Group key={q.id} align="flex-end" wrap="nowrap">
                <TextInput
                  label="Question"
                  placeholder="Where should we deliver it?"
                  value={q.label}
                  onChange={(e) => {
                    const val = e.currentTarget.value;
                    set(
                      'requiredDetails',
                      v.requiredDetails.map((x, j) => (j === i ? { ...x, label: val } : x)),
                    );
                  }}
                  maxLength={200}
                  style={{ flex: 1 }}
                />
                <Select
                  label="Answer"
                  data={[
                    { value: 'text', label: 'Short' },
                    { value: 'textarea', label: 'Long' },
                  ]}
                  value={q.type}
                  onChange={(x) =>
                    set(
                      'requiredDetails',
                      v.requiredDetails.map((y, j) => (j === i ? { ...y, type: x === 'textarea' ? 'textarea' : 'text' } : y)),
                    )
                  }
                  allowDeselect={false}
                  w={110}
                />
                <Checkbox
                  label="Required"
                  checked={Boolean(q.required)}
                  onChange={(e) => {
                    const checked = e.currentTarget.checked;
                    set(
                      'requiredDetails',
                      v.requiredDetails.map((y, j) => (j === i ? { ...y, required: checked } : y)),
                    );
                  }}
                  mb={8}
                />
                <ActionIcon
                  variant="subtle"
                  color="red"
                  aria-label={`Remove question ${i + 1}`}
                  onClick={() =>
                    set(
                      'requiredDetails',
                      v.requiredDetails.filter((_, j) => j !== i),
                    )
                  }
                  mb={4}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
            ))}
            {v.requiredDetails.length < 10 ? (
              <Group>
                <Button
                  variant="light"
                  size="xs"
                  leftSection={<IconPlus size={14} />}
                  onClick={() =>
                    set('requiredDetails', [
                      ...v.requiredDetails,
                      {
                        id: slugId(`question ${v.requiredDetails.length + 1}`, v.requiredDetails.map((q) => q.id)),
                        label: '',
                        type: 'text',
                        required: true,
                      },
                    ])
                  }
                >
                  Add a question
                </Button>
              </Group>
            ) : null}
          </Stack>
        </Paper>

        {mode.kind === 'staff' ? (
          <Paper withBorder p="md">
            <Stack>
              <Title order={2} fz="md">
                Who can buy it
              </Title>
              <MultiSelect
                label="Stand types"
                description="Leave empty for every stand type the category is shown to."
                data={mode.types}
                value={v.visibleToTypes}
                onChange={(x) => set('visibleToTypes', x)}
                clearable
              />
              {mode.canSetCommission ? (
                <>
                  <Text fz="sm" fw={500}>
                    Commission for this product
                  </Text>
                  <SegmentedControl
                    value={v.commissionType ?? 'default'}
                    onChange={(x) => {
                      if (x === 'default') setV((cur) => ({ ...cur, commissionType: null, commissionValue: null }));
                      else setV((cur) => ({ ...cur, commissionType: x as 'percent' | 'fixed', commissionValue: cur.commissionValue ?? 0 }));
                    }}
                    data={[
                      { value: 'default', label: 'Use the category’s' },
                      { value: 'percent', label: 'Percentage' },
                      { value: 'fixed', label: 'Fixed per line' },
                    ]}
                  />
                  {v.commissionType === 'percent' ? (
                    <NumberInput label="Percent" suffix="%" decimalScale={2} min={0} max={100} value={(v.commissionValue ?? 0) / 100} onChange={(x) => set('commissionValue', Math.round(Number(x || 0) * 100))} w={160} error={errors.commissionValue} />
                  ) : v.commissionType === 'fixed' ? (
                    <NumberInput label="Amount" prefix="£" decimalScale={2} min={0} value={(v.commissionValue ?? 0) / 100} onChange={(x) => set('commissionValue', toPence(x))} w={160} error={errors.commissionValue} />
                  ) : null}
                </>
              ) : null}
            </Stack>
          </Paper>
        ) : null}

        <Group>
          {mode.kind === 'staff' ? (
            <>
              <Button type="submit" loading={pending}>
                {mode.productId ? 'Save' : 'Add and put on sale'}
              </Button>
              {!mode.productId ? (
                <Button variant="default" loading={pending} onClick={() => save({ draft: true })}>
                  Save as a draft
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <Button loading={pending} onClick={() => save({ submit: true })}>
                Send for approval
              </Button>
              <Button type="submit" variant="default" loading={pending}>
                {status === 'approved' || status === 'pending_approval' ? 'Save and send for approval' : 'Save as a draft'}
              </Button>
            </>
          )}
        </Group>
      </Stack>
    </form>
  );
}
