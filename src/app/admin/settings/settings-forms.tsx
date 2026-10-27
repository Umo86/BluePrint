'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Group, NumberInput, Paper, SegmentedControl, SimpleGrid, Stack, TagsInput, Text, Textarea, TextInput, Title } from '@mantine/core';
import { TextLink } from '@/components/links';
import { useAction } from '@/lib/use-action';
import { money } from '@/lib/format';
import type { PlatformSettings } from '@/server/services/settings';
import { updateSettingsAction } from '../actions';

function Section({ title, description, children, onSave, pending }: { title: string; description?: string; children: React.ReactNode; onSave: () => void; pending: boolean }) {
  return (
    <Paper withBorder p="md">
      <Title order={2} fz="md">
        {title}
      </Title>
      {description ? (
        <Text fz="sm" c="dimmed" mb="sm">
          {description}
        </Text>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        <Stack mt="sm">
          {children}
          <Group>
            <Button type="submit" loading={pending}>
              Save
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  );
}

const pct = (bps: number) => bps / 100;
const toBps = (v: string | number) => Math.round(Number(v || 0) * 100);
const toPence = (v: string | number) => Math.round(Number(v || 0) * 100);

export function SettingsForms({ settings }: { settings: PlatformSettings }) {
  const router = useRouter();
  const [s, setS] = useState(settings);
  const save = useAction(updateSettingsAction, { onSuccess: () => router.refresh() });
  const [section, setSection] = useState<string | null>(null);
  const run = (name: string, patch: Partial<PlatformSettings>) => {
    setSection(name);
    save.run(patch);
  };
  const busy = (name: string) => save.pending && section === name;

  const exampleNet = 10000;
  const exampleFee = Math.round((exampleNet * 1.2 * s.stripeFeePercentBps) / 10000) + s.stripeFeeFixedPence;

  return (
    <Stack>
      <Section
        title="Card processing fee"
        description="Stripe charges a fee on every card payment. Choose who pays it by default."
        pending={busy('fees')}
        onSave={() => run('fees', { feeMode: s.feeMode, stripeFeePercentBps: s.stripeFeePercentBps, stripeFeeFixedPence: s.stripeFeeFixedPence })}
      >
        <SegmentedControl
          value={s.feeMode}
          onChange={(v) => setS({ ...s, feeMode: v as PlatformSettings['feeMode'] })}
          data={[
            { value: 'exhibitor_pays', label: 'Exhibitor pays it on top' },
            { value: 'deduct_from_supplier', label: 'Taken from the supplier’s share' },
          ]}
        />
        <Group>
          <NumberInput label="Percentage" value={pct(s.stripeFeePercentBps)} onChange={(v) => setS({ ...s, stripeFeePercentBps: toBps(v) })} min={0} max={10} decimalScale={2} suffix="%" w={150} />
          <NumberInput label="Plus fixed amount" value={s.stripeFeeFixedPence / 100} onChange={(v) => setS({ ...s, stripeFeeFixedPence: toPence(v) })} min={0} max={5} decimalScale={2} prefix="£" w={150} />
        </Group>
        <Text fz="sm" c="dimmed">
          Example: an order of {money(exampleNet)} plus VAT has a card fee of about {money(exampleFee)}.{' '}
          {s.feeMode === 'exhibitor_pays' ? 'The exhibitor sees it as a separate line at checkout.' : 'The supplier receives that much less.'}
        </Text>
        {s.feeMode === 'exhibitor_pays' ? (
          <Alert color="yellow" variant="light">
            UK law bans surcharges on consumer cards. Exhibitors pay with business cards, but agree this with finance before switching it on.
          </Alert>
        ) : null}
      </Section>

      <Section
        title="Commission"
        description="The default share you keep from each supplier order. Editions, suppliers, categories and products can override it."
        pending={busy('commission')}
        onSave={() => run('commission', { defaultCommissionType: s.defaultCommissionType, defaultCommissionValue: s.defaultCommissionValue })}
      >
        <SegmentedControl
          value={s.defaultCommissionType}
          onChange={(v) => setS({ ...s, defaultCommissionType: v as 'percent' | 'fixed' })}
          data={[
            { value: 'percent', label: 'Percentage' },
            { value: 'fixed', label: 'Fixed per order line' },
          ]}
        />
        {s.defaultCommissionType === 'percent' ? (
          <NumberInput label="Percent" value={pct(s.defaultCommissionValue)} onChange={(v) => setS({ ...s, defaultCommissionValue: toBps(v) })} min={0} max={100} decimalScale={2} suffix="%" w={150} />
        ) : (
          <NumberInput label="Amount" value={s.defaultCommissionValue / 100} onChange={(v) => setS({ ...s, defaultCommissionValue: toPence(v) })} min={0} decimalScale={2} prefix="£" w={150} />
        )}
      </Section>

      <Section title="VAT" description="Used for new editions. Each edition can set its own rate." pending={busy('vat')} onSave={() => run('vat', { defaultVatRateBps: s.defaultVatRateBps })}>
        <NumberInput label="Default VAT rate" value={pct(s.defaultVatRateBps)} onChange={(v) => setS({ ...s, defaultVatRateBps: toBps(v) })} min={0} max={100} decimalScale={2} suffix="%" w={150} />
      </Section>

      <Section
        title="Invoices"
        description="You are the seller on every order, so these details are printed on every VAT invoice and credit note."
        pending={busy('invoicing')}
        onSave={() => run('invoicing', { invoicing: s.invoicing })}
      >
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Legal company name" value={s.invoicing.legalName} onChange={(e) => setS({ ...s, invoicing: { ...s.invoicing, legalName: e.currentTarget.value } })} maxLength={200} />
          <TextInput label="VAT registration number" value={s.invoicing.vatNumber} onChange={(e) => setS({ ...s, invoicing: { ...s.invoicing, vatNumber: e.currentTarget.value } })} maxLength={40} />
          <TextInput label="Company number" value={s.invoicing.companyNumber} onChange={(e) => setS({ ...s, invoicing: { ...s.invoicing, companyNumber: e.currentTarget.value } })} maxLength={40} />
          <NumberInput label="Invoice payment terms (days)" value={s.invoicing.dueDays} onChange={(v) => setS({ ...s, invoicing: { ...s.invoicing, dueDays: Number(v || 0) } })} min={0} max={120} />
          <TextInput label="Accounts email" value={s.invoicing.email} onChange={(e) => setS({ ...s, invoicing: { ...s.invoicing, email: e.currentTarget.value } })} maxLength={200} />
          <TextInput label="Accounts phone" value={s.invoicing.phone} onChange={(e) => setS({ ...s, invoicing: { ...s.invoicing, phone: e.currentTarget.value } })} maxLength={40} />
        </SimpleGrid>
        <Textarea label="Registered address" value={s.invoicing.address} onChange={(e) => setS({ ...s, invoicing: { ...s.invoicing, address: e.currentTarget.value } })} autosize minRows={3} maxLength={500} />
        <Textarea
          label="How to pay an invoice"
          description="Bank details for invoice customers: account name, sort code, account number, IBAN. Shown only on unpaid invoices."
          value={s.invoicing.paymentInstructions}
          onChange={(e) => setS({ ...s, invoicing: { ...s.invoicing, paymentInstructions: e.currentTarget.value } })}
          autosize
          minRows={3}
          maxLength={600}
        />
        <TextInput label="Footer note" value={s.invoicing.footer} onChange={(e) => setS({ ...s, invoicing: { ...s.invoicing, footer: e.currentTarget.value } })} maxLength={400} />
      </Section>

      <Section
        title="Order terms"
        description="Shown at checkout. When set, exhibitors must accept them before ordering. Leave empty for none."
        pending={busy('terms')}
        onSave={() => run('terms', { orderTerms: s.orderTerms })}
      >
        <Textarea value={s.orderTerms} onChange={(e) => setS({ ...s, orderTerms: e.currentTarget.value })} autosize minRows={4} maxLength={5000} aria-label="Order terms" />
      </Section>

      <Section
        title="Reminders"
        description="When BluePrint (and the assistant) remind exhibitors about a deadline, in days before it. Tasks can set their own."
        pending={busy('reminders')}
        onSave={() => run('reminders', { reminderOffsets: s.reminderOffsets })}
      >
        <TagsInput
          label="Days before the deadline"
          description="Type a number and press Enter. Up to six."
          value={s.reminderOffsets.map(String)}
          onChange={(vals) =>
            setS({
              ...s,
              reminderOffsets: [...new Set(vals.map((v) => Number.parseInt(v, 10)).filter((n) => Number.isFinite(n) && n >= 1 && n <= 365))]
                .sort((a, b) => b - a)
                .slice(0, 6),
            })
          }
          maxTags={6}
          w={360}
        />
      </Section>

      <Section
        title="Email defaults"
        description="Used when an edition has not set its own sender. The sending domain must be verified in Resend with SPF, DKIM and DMARC."
        pending={busy('email')}
        onSave={() => run('email', { emailDefaults: s.emailDefaults })}
      >
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <TextInput label="Sender name" value={s.emailDefaults.senderName} onChange={(e) => setS({ ...s, emailDefaults: { ...s.emailDefaults, senderName: e.currentTarget.value } })} />
          <TextInput
            label="Sender address"
            placeholder="noreply@mail.yourshow.com"
            value={s.emailDefaults.senderAddress}
            onChange={(e) => setS({ ...s, emailDefaults: { ...s.emailDefaults, senderAddress: e.currentTarget.value } })}
          />
          <TextInput label="Reply-to address" value={s.emailDefaults.replyTo} onChange={(e) => setS({ ...s, emailDefaults: { ...s.emailDefaults, replyTo: e.currentTarget.value } })} />
        </SimpleGrid>
      </Section>

      <Section
        title="How long records are kept"
        description="BluePrint deletes or anonymises records automatically once they pass these ages. UK law requires financial records for six years."
        pending={busy('retention')}
        onSave={() => run('retention', { retention: s.retention })}
      >
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <NumberInput label="Orders and invoices (years)" value={s.retention.ordersYears} onChange={(v) => setS({ ...s, retention: { ...s.retention, ordersYears: Number(v || 6) } })} min={6} max={20} />
          <NumberInput
            label="Space-only packs (years after the show)"
            value={s.retention.spaceOnlyYearsAfterShow}
            onChange={(v) => setS({ ...s, retention: { ...s.retention, spaceOnlyYearsAfterShow: Number(v || 6) } })}
            min={1}
            max={20}
          />
          <NumberInput label="Incident reports (years)" value={s.retention.incidentYears} onChange={(v) => setS({ ...s, retention: { ...s.retention, incidentYears: Number(v || 3) } })} min={1} max={20} />
          <NumberInput
            label="Inactive contacts (years)"
            value={s.retention.inactiveContactYears}
            onChange={(v) => setS({ ...s, retention: { ...s.retention, inactiveContactYears: Number(v || 3) } })}
            min={1}
            max={20}
          />
          <NumberInput label="Email logs (months)" value={s.retention.emailLogMonths} onChange={(v) => setS({ ...s, retention: { ...s.retention, emailLogMonths: Number(v || 24) } })} min={1} max={120} />
          <NumberInput
            label="Assistant conversations (months)"
            value={s.retention.assistantMonths}
            onChange={(v) => setS({ ...s, retention: { ...s.retention, assistantMonths: Number(v || 12) } })}
            min={1}
            max={60}
          />
        </SimpleGrid>
      </Section>

      <Section title="Notice for everyone" pending={busy('notice')} onSave={() => run('notice', { maintenanceMessage: s.maintenanceMessage })}>
        <Textarea
          label="Notice shown to everyone"
          description="Shown at the top of every page, for example planned maintenance. Leave empty for none."
          value={s.maintenanceMessage}
          onChange={(e) => setS({ ...s, maintenanceMessage: e.currentTarget.value })}
          maxLength={500}
          autosize
          minRows={2}
        />
        <Text fz="sm" c="dimmed">
          The exhibitor assistant’s switch, model, limits and instructions are on the{' '}
          <TextLink href="/admin/assistant" fz="sm">
            AI assistant
          </TextLink>{' '}
          page.
        </Text>
      </Section>
    </Stack>
  );
}
