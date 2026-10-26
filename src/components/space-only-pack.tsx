'use client';

import { useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Checkbox,
  Group,
  List,
  ListItem,
  Modal,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { IconCertificate, IconCheck, IconCircleDashed, IconFile, IconX } from '@tabler/icons-react';
import { FileUpload } from './file-upload';
import { useAction } from '@/lib/use-action';
import { checkPack, PACK_STATUS_LABELS, SPACE_ONLY_DOCS, SPACE_ONLY_DOC_LABELS, type Declared, type SpaceOnlyRulesLike } from '@/lib/space-only';
import { formatBytes } from '@/lib/upload-rules';
import { nominateContractorAction, removeContractorAction, savePackDraftAction, submitPackAction } from '@/app/space-only-actions';

export type PackProps = {
  standId: string;
  role: 'exhibitor' | 'main_contact' | 'contractor';
  status: string;
  conditions: string | null;
  certificateFileId: string | null;
  currentVersion: number;
  rules: SpaceOnlyRulesLike;
  breakdownEndsAt: string | null;
  declared: Declared;
  documents: Record<string, string[]>;
  files: Record<string, { name: string; size: number }>;
  contractor: { companyName: string; contactName: string; email: string; phone: string | null; status: string } | null;
  reviews: { id: string; version: number; by: string; outcome: string; docType: string | null; comment: string | null; at: string }[];
  editable: boolean;
  canNominate: boolean;
  companyName: string;
};

function ContractorCard({ p }: { p: PackProps }) {
  const [open, setOpen] = useState(false);
  const [selfBuild, setSelfBuild] = useState(false);
  const [f, setF] = useState({ companyName: p.contractor?.companyName ?? '', contactName: p.contractor?.contactName ?? '', email: p.contractor?.email ?? '', phone: p.contractor?.phone ?? '' });
  const save = useAction(nominateContractorAction, { onSuccess: () => setOpen(false) });
  const remove = useAction(removeContractorAction);
  const locked = !['not_started', 'changes_needed', 'rejected'].includes(p.status);
  return (
    <Paper withBorder p="md">
      <Group justify="space-between" mb="xs">
        <Title order={2} fz="md">
          1. Your stand contractor
        </Title>
        {p.contractor ? (
          <Badge color={p.contractor.status === 'active' ? 'green' : 'yellow'} variant="light">
            {p.contractor.status === 'active' ? 'On BluePrint' : 'Invited'}
          </Badge>
        ) : null}
      </Group>
      {p.contractor ? (
        <Stack gap={2}>
          <Text fw={600}>{p.contractor.companyName}</Text>
          <Text fz="sm">
            {p.contractor.contactName} · {p.contractor.email}
            {p.contractor.phone ? ` · ${p.contractor.phone}` : ''}
          </Text>
          {p.contractor.status !== 'active' ? (
            <Text fz="xs" c="dimmed">
              They have been emailed an invitation. Once they join, they can upload the stand pack too.
            </Text>
          ) : null}
        </Stack>
      ) : (
        <Text fz="sm" c="dimmed">
          Tell us who is building your stand. They get their own access to send drawings and safety documents.
        </Text>
      )}
      {p.canNominate && !locked ? (
        <Group mt="sm" gap="xs">
          <Button size="xs" variant={p.contractor ? 'default' : 'filled'} onClick={() => setOpen(true)}>
            {p.contractor ? 'Change contractor' : 'Nominate your contractor'}
          </Button>
          {p.contractor ? (
            <Button size="xs" variant="subtle" color="red" loading={remove.pending} onClick={() => remove.run(p.standId)}>
              Remove
            </Button>
          ) : null}
        </Group>
      ) : null}
      <Modal opened={open} onClose={() => setOpen(false)} title="Your stand contractor">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.run(p.standId, selfBuild ? { selfBuild: true } : { ...f, selfBuild: false });
          }}
        >
          <Stack>
            <Checkbox label={`${p.companyName} is building the stand itself`} checked={selfBuild} onChange={(e) => setSelfBuild(e.currentTarget.checked)} />
            {!selfBuild ? (
              <>
                <TextInput label="Contractor company" required value={f.companyName} onChange={(e) => setF({ ...f, companyName: e.currentTarget.value })} error={save.fieldErrors.companyName} />
                <TextInput label="Contact name" required value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.currentTarget.value })} error={save.fieldErrors.contactName} />
                <TextInput label="Contact email" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.currentTarget.value })} error={save.fieldErrors.email} />
                <TextInput label="Contact phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.currentTarget.value })} />
              </>
            ) : null}
            <Group justify="flex-end">
              <Button type="submit" loading={save.pending}>
                Save
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Paper>
  );
}

/** The space-only stand pack: details, documents, what is missing, sending and the team's comments. */
export function SpaceOnlyPack(p: PackProps) {
  const [declared, setDeclared] = useState<Declared>(p.declared);
  const [docs, setDocs] = useState<Record<string, string[]>>(p.documents);
  const [files, setFiles] = useState(p.files);
  const [dirty, setDirty] = useState(false);
  const check = useMemo(() => checkPack(p.rules, declared, docs, { breakdownEndsAt: p.breakdownEndsAt }), [p.rules, declared, docs, p.breakdownEndsAt]);
  const save = useAction(savePackDraftAction, { onSuccess: () => setDirty(false) });
  const submit = useAction(submitPackAction);
  const status = PACK_STATUS_LABELS[p.status] ?? { label: p.status, color: 'gray' };
  const update = (d: Partial<Declared>) => {
    setDeclared((x) => ({ ...x, ...d }));
    setDirty(true);
  };
  const payload = () => ({ heightM: declared.heightM, platformMm: declared.platformMm, hasSteps: declared.hasSteps, insuranceCoverGbp: declared.insuranceCoverGbp, insuranceExpiresOn: declared.insuranceExpiresOn, documents: docs });
  const otherDocs = SPACE_ONLY_DOCS.filter((d) => !check.neededDocs.includes(d.key));
  const ro = !p.editable;
  // Once the pack is with the show team (or approved), the "ready to send" prompt no longer applies.
  const sent = ro && (['submitted', 'under_review'].includes(p.status) || p.status.startsWith('approved'));

  const docBlock = (key: string, label: string, help: string, required: boolean) => (
    <Paper key={key} withBorder p="sm" data-testid={`doc-${key}`}>
      <Group justify="space-between" mb={4}>
        <Group gap={6}>
          <ThemeIcon size={20} radius="xl" color={(docs[key] ?? []).length ? 'green' : required ? 'gray' : 'gray'} variant={(docs[key] ?? []).length ? 'filled' : 'light'}>
            {(docs[key] ?? []).length ? <IconCheck size={12} /> : <IconCircleDashed size={12} />}
          </ThemeIcon>
          <Text fw={600} fz="sm">
            {label}
          </Text>
          {required ? (
            <Badge size="xs" variant="outline" color="red">
              Required
            </Badge>
          ) : null}
        </Group>
      </Group>
      <Text fz="xs" c="dimmed" mb={6}>
        {help}
      </Text>
      <Stack gap={4}>
        {(docs[key] ?? []).map((fid) => (
          <Group key={fid} gap="xs">
            <IconFile size={16} />
            <Anchor href={`/files/${fid}`} target="_blank" fz="sm">
              {files[fid]?.name ?? 'Document'}
            </Anchor>
            {files[fid] ? (
              <Text fz="xs" c="dimmed">
                {formatBytes(files[fid].size)}
              </Text>
            ) : null}
            {!ro ? (
              <ActionIcon
                size="sm"
                variant="subtle"
                color="red"
                aria-label={`Remove ${files[fid]?.name ?? 'document'}`}
                onClick={() => {
                  setDocs((d) => ({ ...d, [key]: (d[key] ?? []).filter((x) => x !== fid) }));
                  setDirty(true);
                }}
              >
                <IconX size={14} />
              </ActionIcon>
            ) : null}
          </Group>
        ))}
        {!ro ? (
          <FileUpload
            purpose="space_only"
            scope={{ standId: p.standId }}
            multiple
            label={`Add ${label.toLowerCase()}`}
            onUploaded={(f) => {
              setFiles((x) => ({ ...x, [f.fileId]: { name: f.name, size: f.size } }));
              setDocs((d) => ({ ...d, [key]: [...(d[key] ?? []), f.fileId] }));
              setDirty(true);
            }}
          />
        ) : null}
      </Stack>
    </Paper>
  );

  return (
    <Stack>
      <Paper withBorder p="md">
        <Group justify="space-between">
          <div>
            <Text fz="sm" fw={500} c="dimmed">
              Stand approval
            </Text>
            <Group gap="xs" mt={4}>
              <Badge size="lg" color={status.color} variant="light">
                {status.label}
              </Badge>
              {p.currentVersion ? (
                <Text fz="sm" c="dimmed">
                  Version {p.currentVersion} sent
                </Text>
              ) : null}
            </Group>
          </div>
          {p.certificateFileId ? (
            <Button component="a" href={`/files/${p.certificateFileId}?download=1`} leftSection={<IconCertificate size={18} />} color="green">
              Download permission to build
            </Button>
          ) : null}
        </Group>
        {p.conditions ? (
          <Alert color="lime" mt="sm" title="Conditions">
            {p.conditions}
          </Alert>
        ) : null}
      </Paper>

      {p.role !== 'contractor' ? <ContractorCard p={p} /> : null}

      <Paper withBorder p="md">
        <Title order={2} fz="md" mb="sm">
          {p.role !== 'contractor' ? '2. ' : ''}About the stand
        </Title>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <NumberInput label="Highest point of the stand (metres)" value={declared.heightM ?? ''} onChange={(v) => update({ heightM: v === '' ? null : Number(v) })} min={0} max={50} decimalScale={2} readOnly={ro} />
          <NumberInput label="Platform height (millimetres)" description="Enter 0 if there is no platform." value={declared.platformMm ?? ''} onChange={(v) => update({ platformMm: v === '' ? null : Number(v) })} min={0} max={10000} readOnly={ro} />
          <NumberInput
            label="Contractor’s public liability cover (£)"
            value={declared.insuranceCoverGbp ?? ''}
            onChange={(v) => update({ insuranceCoverGbp: v === '' ? null : Number(v) })}
            min={0}
            thousandSeparator=","
            prefix="£"
            readOnly={ro}
          />
          <DateInput label="Insurance expires on" value={declared.insuranceExpiresOn} onChange={(v) => update({ insuranceExpiresOn: v })} valueFormat="D MMMM YYYY" readOnly={ro} clearable={!ro} />
        </SimpleGrid>
        <Switch mt="sm" label="The stand has steps, a raised area people walk on, or a second level" checked={declared.hasSteps} onChange={(e) => update({ hasSteps: e.currentTarget.checked })} disabled={ro} />
        {check.isComplex ? (
          <Alert color="orange" mt="sm">
            This counts as a complex stand ({check.complexReasons.join(', ')}), so structural calculations from a qualified engineer are also needed.
          </Alert>
        ) : null}
      </Paper>

      <Paper withBorder p="md">
        <Title order={2} fz="md" mb="sm">
          {p.role !== 'contractor' ? '3. ' : ''}Documents
        </Title>
        <Stack gap="sm">
          {check.neededDocs.map((key) => {
            const d = SPACE_ONLY_DOCS.find((x) => x.key === key);
            return docBlock(key, d?.label ?? key, d?.help ?? '', true);
          })}
          {otherDocs.some((d) => (docs[d.key] ?? []).length) || !ro ? (
            <Text fz="sm" fw={600} mt="xs">
              Other documents (if you have them)
            </Text>
          ) : null}
          {otherDocs.filter((d) => !ro || (docs[d.key] ?? []).length).map((d) => docBlock(d.key, d.label, d.help, false))}
        </Stack>
      </Paper>

      <Paper withBorder p="md">
        <Title order={2} fz="md" mb="sm">
          {sent ? (p.status.startsWith('approved') ? 'Approved' : 'Sent for review') : check.complete ? 'Ready to send' : 'Still needed before you can send'}
        </Title>
        {sent ? null : check.missing.length ? (
          <List size="sm" spacing={4} icon={<IconCircleDashed size={14} />}>
            {check.missing.map((m) => (
              <ListItem key={m}>{m}</ListItem>
            ))}
          </List>
        ) : (
          <Text fz="sm">Everything required is here. Send it to the show team for review.</Text>
        )}
        {!ro ? (
          <Group mt="md">
            <Button variant="default" loading={save.pending} disabled={!dirty} onClick={() => save.run(p.standId, payload())}>
              Save
            </Button>
            <Button
              loading={submit.pending || save.pending}
              disabled={!check.complete || !p.contractor}
              onClick={async () => {
                const saved = dirty ? await save.run(p.standId, payload()) : { ok: true as const };
                if (saved.ok) await submit.run(p.standId);
              }}
            >
              Send for review
            </Button>
            {!p.contractor ? (
              <Text fz="xs" c="dimmed">
                Nominate the contractor first.
              </Text>
            ) : null}
          </Group>
        ) : (
          <Text fz="xs" c="dimmed" mt="sm">
            {['submitted', 'under_review'].includes(p.status)
              ? 'The show team is reviewing your pack. You will be emailed when they decide.'
              : p.status.startsWith('approved')
                ? 'Your stand is approved. If you need to change the design, contact the show team.'
                : 'Changes are switched off.'}
          </Text>
        )}
      </Paper>

      {p.reviews.length ? (
        <Paper withBorder p="md">
          <Title order={2} fz="md" mb="sm">
            Comments from the show team
          </Title>
          <Stack gap="sm">
            {p.reviews
              .filter((r) => r.comment)
              .map((r) => (
                <Paper key={r.id} withBorder p="sm" bg="var(--mantine-color-gray-0)">
                  <Group gap="xs" mb={4}>
                    <Badge size="sm" variant="light">
                      {r.by}
                    </Badge>
                    <Badge size="sm" variant="light" color={PACK_STATUS_LABELS[r.outcome]?.color ?? 'gray'}>
                      {PACK_STATUS_LABELS[r.outcome]?.label ?? 'Comment'}
                    </Badge>
                    {r.docType ? (
                      <Text fz="xs" c="dimmed">
                        on {SPACE_ONLY_DOC_LABELS[r.docType] ?? r.docType}
                      </Text>
                    ) : null}
                    <Text fz="xs" c="dimmed">
                      version {r.version} · {new Date(r.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' })}
                    </Text>
                  </Group>
                  <Text fz="sm" style={{ whiteSpace: 'pre-wrap' }}>
                    {r.comment}
                  </Text>
                </Paper>
              ))}
          </Stack>
        </Paper>
      ) : null}
    </Stack>
  );
}
