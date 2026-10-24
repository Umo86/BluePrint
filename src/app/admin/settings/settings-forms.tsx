'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Group, NumberInput, Paper, SegmentedControl, SimpleGrid, Stack, Switch, TagsInput, Text, Textarea, TextInput, Title } from '@mantine/core';
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
        title="Media10 commission"
        description="The default share Media10 keeps from each supplier order. Editions, suppliers, categories and products can override it."
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
            placeholder="noreply@blueprint.media10.co.uk"
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
        </SimpleGrid>
      </Section>

      <Section
        title="Assistant and notices"
        pending={busy('assistant')}
        onSave={() => run('assistant', { assistantEnabled: s.assistantEnabled, maintenanceMessage: s.maintenanceMessage })}
      >
        <Switch
          label="Exhibitor assistant switched on"
          description="Turns the AI assistant off everywhere at once (for example if something goes wrong)."
          checked={s.assistantEnabled}
          onChange={(e) => setS({ ...s, assistantEnabled: e.currentTarget.checked })}
        />
        <Textarea
          label="Notice shown to everyone"
          description="Shown at the top of every page, for example planned maintenance. Leave empty for none."
          value={s.maintenanceMessage}
          onChange={(e) => setS({ ...s, maintenanceMessage: e.currentTarget.value })}
          maxLength={500}
          autosize
          minRows={2}
        />
      </Section>
    </Stack>
  );
}
