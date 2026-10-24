'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  ColorInput,
  Group,
  Image,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconArrowDown, IconArrowUp, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import { EditionDetailsForm, type EditionDetailsValues } from '@/components/edition-details-form';
import { FileUpload } from '@/components/file-upload';
import { SPACE_ONLY_DOCS } from '@/lib/space-only';
import type { SpaceOnlyRules } from '@/server/db/schema';
import {
  createHallAction,
  createTypeAction,
  deleteHallAction,
  deleteTypeAction,
  moveHallAction,
  moveTypeAction,
  renameHallAction,
  updateBrandingAction,
  updateDetailsAction,
  updateEmailSettingsAction,
  updateSpaceOnlyRulesAction,
  updateTypeAction,
} from '../../actions';

type Img = { fileId: string; url: string; name: string } | null;
type Branding = { primaryColor: string; accentColor: string; footerText: string; logo: Img; header: Img; editionName: string };
type TypeRow = { id: string; key: string; name: string; description: string; isSpaceOnly: boolean; builtIn: boolean; standCount: number };
type HallRow = { id: string; name: string; standCount: number };
type EmailValues = { senderName: string; senderAddress: string; replyTo: string; campaignSenderAddress: string; platformDefault: string };

const LABELS: Record<string, string> = {
  details: 'Details',
  branding: 'Branding',
  types: 'Stand types',
  halls: 'Halls',
  email: 'Email sender',
  space_only: 'Space-only rules',
};

export function SettingsTabs(props: {
  editionId: string;
  tabs: string[];
  initialTab: string;
  details: EditionDetailsValues;
  allowArchive: boolean;
  branding: Branding;
  types: TypeRow[];
  halls: HallRow[];
  email: EmailValues;
  spaceOnly: SpaceOnlyRules;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState(props.initialTab);
  return (
    <Tabs
      value={tab}
      onChange={(v) => {
        if (!v) return;
        setTab(v);
        router.replace(`${pathname}?tab=${v}`, { scroll: false });
      }}
      keepMounted={false}
    >
      <Tabs.List mb="md">
        {props.tabs.map((t) => (
          <Tabs.Tab key={t} value={t}>
            {LABELS[t]}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      <Tabs.Panel value="details">
        <EditionDetailsForm edition={props.details} action={updateDetailsAction} allowArchive={props.allowArchive} />
      </Tabs.Panel>
      <Tabs.Panel value="branding">
        <BrandingForm editionId={props.editionId} initial={props.branding} />
      </Tabs.Panel>
      <Tabs.Panel value="types">
        <TypesManager editionId={props.editionId} types={props.types} />
      </Tabs.Panel>
      <Tabs.Panel value="halls">
        <HallsManager editionId={props.editionId} halls={props.halls} />
      </Tabs.Panel>
      <Tabs.Panel value="email">
        <EmailForm editionId={props.editionId} initial={props.email} />
      </Tabs.Panel>
      <Tabs.Panel value="space_only">
        <SpaceOnlyForm editionId={props.editionId} initial={props.spaceOnly} />
      </Tabs.Panel>
    </Tabs>
  );
}

// Branding -----------------------------------------------------------------------

function BrandingForm({ editionId, initial }: { editionId: string; initial: Branding }) {
  const [b, setB] = useState(initial);
  const save = useAction(updateBrandingAction);
  return (
    <SimpleGrid cols={{ base: 1, lg: 2 }}>
      <Paper withBorder p="lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.run(editionId, {
              primaryColor: b.primaryColor,
              accentColor: b.accentColor,
              footerText: b.footerText,
              logoFileId: b.logo?.fileId ?? null,
              headerImageFileId: b.header?.fileId ?? null,
            });
          }}
        >
          <Stack>
            <Group grow>
              <ColorInput label="Main colour" value={b.primaryColor} onChange={(v) => setB({ ...b, primaryColor: v })} format="hex" error={save.fieldErrors.primaryColor} />
              <ColorInput label="Accent colour" value={b.accentColor} onChange={(v) => setB({ ...b, accentColor: v })} format="hex" error={save.fieldErrors.accentColor} />
            </Group>
            <div>
              <Text fz="sm" fw={600} mb={4}>
                Logo
              </Text>
              {b.logo ? (
                <Group mb="xs">
                  <Image src={b.logo.url} alt="Current logo" h={48} w="auto" fit="contain" />
                  <Button size="xs" variant="subtle" color="red" onClick={() => setB({ ...b, logo: null })}>
                    Remove
                  </Button>
                </Group>
              ) : null}
              <FileUpload purpose="branding" scope={{ editionId }} label="Drop the show logo here" onUploaded={(f) => setB((x) => ({ ...x, logo: { fileId: f.fileId, url: f.url, name: f.name } }))} />
            </div>
            <div>
              <Text fz="sm" fw={600} mb={4}>
                Header image (optional)
              </Text>
              {b.header ? (
                <Group mb="xs">
                  <Image src={b.header.url} alt="Current header image" h={48} w="auto" fit="contain" />
                  <Button size="xs" variant="subtle" color="red" onClick={() => setB({ ...b, header: null })}>
                    Remove
                  </Button>
                </Group>
              ) : null}
              <FileUpload purpose="branding" scope={{ editionId }} label="Drop a wide banner image here" onUploaded={(f) => setB((x) => ({ ...x, header: { fileId: f.fileId, url: f.url, name: f.name } }))} />
            </div>
            <Textarea
              label="Email footer"
              description="Shown at the bottom of every email, for example the organiser’s address."
              value={b.footerText}
              onChange={(e) => setB({ ...b, footerText: e.currentTarget.value })}
              maxLength={500}
              autosize
              minRows={2}
            />
            <Group>
              <Button type="submit" loading={save.pending}>
                Save branding
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>
      <Paper withBorder p="lg">
        <Text fz="sm" fw={600} mb="sm">
          Preview
        </Text>
        <Box style={{ border: '1px solid var(--mantine-color-gray-3)', borderRadius: 8, overflow: 'hidden' }}>
          <Group bg={b.primaryColor} p="sm" gap="sm">
            {b.logo ? <Image src={b.logo.url} alt="" h={32} w="auto" fit="contain" bg="white" p={2} style={{ borderRadius: 4 }} /> : null}
            <Text c="white" fw={700}>
              {b.editionName}
            </Text>
          </Group>
          {b.header ? <Image src={b.header.url} alt="" h={90} fit="cover" /> : null}
          <Stack p="md" gap="xs">
            <Text fw={600}>Your exhibitor checklist</Text>
            <Text fz="sm" c="dimmed">
              This is how the portal and emails will look to exhibitors.
            </Text>
            <Button color={b.accentColor} size="xs" style={{ alignSelf: 'flex-start' }}>
              Start your next task
            </Button>
          </Stack>
          {b.footerText ? (
            <Text fz="xs" c="dimmed" p="sm" bg="var(--mantine-color-gray-0)" style={{ whiteSpace: 'pre-wrap' }}>
              {b.footerText}
            </Text>
          ) : null}
        </Box>
      </Paper>
    </SimpleGrid>
  );
}

// Stand types ---------------------------------------------------------------------

function TypesManager({ editionId, types }: { editionId: string; types: TypeRow[] }) {
  const [editing, setEditing] = useState<TypeRow | null>(null);
  const [form, setForm] = useState({ name: '', description: '', isSpaceOnly: false });
  const create = useAction(createTypeAction, { onSuccess: () => setEditing(null) });
  const update = useAction(updateTypeAction, { onSuccess: () => setEditing(null) });
  const del = useAction(deleteTypeAction);
  const move = useAction(moveTypeAction, { notifyErrors: true });
  const open = (t: TypeRow | null) => {
    setEditing(t ?? { id: '', key: '', name: '', description: '', isSpaceOnly: false, builtIn: false, standCount: 0 });
    setForm({ name: t?.name ?? '', description: t?.description ?? '', isSpaceOnly: t?.isSpaceOnly ?? false });
  };
  return (
    <Paper withBorder p="md">
      <Group justify="space-between" mb="sm">
        <div>
          <Title order={2} fz="md">
            Stand types
          </Title>
          <Text fz="sm" c="dimmed">
            Each stand has a type. Tasks and manual pages are shown according to it. Space-only types get contractor nomination and stand approval.
          </Text>
        </div>
        <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => open(null)}>
          Add a type
        </Button>
      </Group>
      <Table>
        <TableThead>
          <TableTr>
            <TableTh>Type</TableTh>
            <TableTh>Approval needed</TableTh>
            <TableTh>Stands</TableTh>
            <TableTh />
          </TableTr>
        </TableThead>
        <TableTbody>
          {types.map((t, i) => (
            <TableTr key={t.id}>
              <TableTd>
                <Group gap={6}>
                  <Text fz="sm" fw={600}>
                    {t.name}
                  </Text>
                  {t.builtIn ? (
                    <Badge size="xs" variant="outline" color="gray">
                      Built in
                    </Badge>
                  ) : null}
                </Group>
                {t.description ? (
                  <Text fz="xs" c="dimmed">
                    {t.description}
                  </Text>
                ) : null}
              </TableTd>
              <TableTd>{t.isSpaceOnly ? 'Yes (space-only rules)' : 'No'}</TableTd>
              <TableTd>{t.standCount}</TableTd>
              <TableTd>
                <Group gap={4} justify="flex-end" wrap="nowrap">
                  <ActionIcon variant="subtle" aria-label={`Move ${t.name} up`} disabled={i === 0} onClick={() => move.run(editionId, t.id, 'up')}>
                    <IconArrowUp size={16} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" aria-label={`Move ${t.name} down`} disabled={i === types.length - 1} onClick={() => move.run(editionId, t.id, 'down')}>
                    <IconArrowDown size={16} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" aria-label={`Edit ${t.name}`} onClick={() => open(t)}>
                    <IconPencil size={16} />
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    aria-label={`Delete ${t.name}`}
                    disabled={t.builtIn || t.standCount > 0}
                    onClick={() =>
                      modals.openConfirmModal({
                        title: `Delete the ${t.name} type?`,
                        labels: { confirm: 'Delete', cancel: 'Cancel' },
                        confirmProps: { color: 'red' },
                        onConfirm: () => del.run(editionId, t.id),
                      })
                    }
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              </TableTd>
            </TableTr>
          ))}
        </TableTbody>
      </Table>
      <Modal opened={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.id ? `Edit ${editing.name}` : 'Add a stand type'}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (editing?.id) update.run(editionId, editing.id, form);
            else create.run(editionId, form);
          }}
        >
          <Stack>
            <TextInput label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} error={create.fieldErrors.name ?? update.fieldErrors.name} data-autofocus />
            <TextInput label="Description" description="Shown to the team, for example what is included." value={form.description} onChange={(e) => setForm({ ...form, description: e.currentTarget.value })} />
            <Switch
              label="Needs stand approval (space-only rules)"
              description="Exhibitors nominate a contractor and send drawings, risk assessments and insurance for approval."
              checked={form.isSpaceOnly}
              disabled={Boolean(editing?.builtIn)}
              onChange={(e) => setForm({ ...form, isSpaceOnly: e.currentTarget.checked })}
            />
            <Group justify="flex-end">
              <Button type="submit" loading={create.pending || update.pending}>
                Save type
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Paper>
  );
}

// Halls ------------------------------------------------------------------------------

function HallsManager({ editionId, halls }: { editionId: string; halls: HallRow[] }) {
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<HallRow | null>(null);
  const [newName, setNewName] = useState('');
  const create = useAction(createHallAction, { onSuccess: () => setName('') });
  const rename = useAction(renameHallAction, { onSuccess: () => setRenaming(null) });
  const del = useAction(deleteHallAction);
  const move = useAction(moveHallAction);
  return (
    <Paper withBorder p="md">
      <Title order={2} fz="md">
        Halls
      </Title>
      <Text fz="sm" c="dimmed" mb="sm">
        Used to group stands, for floor plans and for deliveries. Imports add missing halls automatically.
      </Text>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.run(editionId, name);
        }}
      >
        <Group align="flex-end" gap="xs" mb="md">
          <TextInput label="New hall" placeholder="N1" value={name} onChange={(e) => setName(e.currentTarget.value)} error={create.fieldErrors.name} w={220} />
          <Button type="submit" loading={create.pending} disabled={!name.trim()}>
            Add hall
          </Button>
        </Group>
      </form>
      {halls.length ? (
        <Table>
          <TableThead>
            <TableTr>
              <TableTh>Hall</TableTh>
              <TableTh>Stands</TableTh>
              <TableTh />
            </TableTr>
          </TableThead>
          <TableTbody>
            {halls.map((h, i) => (
              <TableTr key={h.id}>
                <TableTd fw={600}>{h.name}</TableTd>
                <TableTd>{h.standCount}</TableTd>
                <TableTd>
                  <Group gap={4} justify="flex-end" wrap="nowrap">
                    <ActionIcon variant="subtle" aria-label={`Move ${h.name} up`} disabled={i === 0} onClick={() => move.run(editionId, h.id, 'up')}>
                      <IconArrowUp size={16} />
                    </ActionIcon>
                    <ActionIcon variant="subtle" aria-label={`Move ${h.name} down`} disabled={i === halls.length - 1} onClick={() => move.run(editionId, h.id, 'down')}>
                      <IconArrowDown size={16} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      aria-label={`Rename ${h.name}`}
                      onClick={() => {
                        setRenaming(h);
                        setNewName(h.name);
                      }}
                    >
                      <IconPencil size={16} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label={`Delete ${h.name}`}
                      onClick={() =>
                        modals.openConfirmModal({
                          title: `Delete hall ${h.name}?`,
                          children: <Text fz="sm">{h.standCount ? `Its ${h.standCount} stands stay, without a hall.` : 'No stands are in this hall.'}</Text>,
                          labels: { confirm: 'Delete', cancel: 'Cancel' },
                          confirmProps: { color: 'red' },
                          onConfirm: () => del.run(editionId, h.id),
                        })
                      }
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                </TableTd>
              </TableTr>
            ))}
          </TableTbody>
        </Table>
      ) : (
        <Text fz="sm" c="dimmed">
          No halls yet.
        </Text>
      )}
      <Modal opened={Boolean(renaming)} onClose={() => setRenaming(null)} title="Rename hall">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (renaming) rename.run(editionId, renaming.id, newName);
          }}
        >
          <Stack>
            <TextInput label="Hall name" value={newName} onChange={(e) => setNewName(e.currentTarget.value)} error={rename.fieldErrors.name} data-autofocus />
            <Group justify="flex-end">
              <Button type="submit" loading={rename.pending}>
                Save
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Paper>
  );
}

// Email sender -------------------------------------------------------------------------

function EmailForm({ editionId, initial }: { editionId: string; initial: EmailValues }) {
  const [f, setF] = useState(initial);
  const save = useAction(updateEmailSettingsAction);
  return (
    <Paper withBorder p="lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.run(editionId, { senderName: f.senderName, senderAddress: f.senderAddress, replyTo: f.replyTo, campaignSenderAddress: f.campaignSenderAddress });
        }}
      >
        <Stack>
          <Alert variant="light" color="blue" title="Getting email into inboxes">
            Send from an address on a subdomain you have verified in Resend (for example manual@mail.ukconstructionweek.com) with SPF, DKIM and a DMARC policy. Use a separate
            subdomain for campaigns so marketing never affects deadline and order emails.
          </Alert>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label="Sender name" placeholder="UKCW Exhibitor Team" value={f.senderName} onChange={(e) => setF({ ...f, senderName: e.currentTarget.value })} />
            <TextInput
              label="Sender address"
              placeholder={`Leave empty to use ${f.platformDefault}`}
              value={f.senderAddress}
              onChange={(e) => setF({ ...f, senderAddress: e.currentTarget.value })}
              error={save.fieldErrors.senderAddress}
            />
            <TextInput label="Reply-to address" description="Where exhibitor replies go, for example the operations inbox." value={f.replyTo} onChange={(e) => setF({ ...f, replyTo: e.currentTarget.value })} error={save.fieldErrors.replyTo} />
            <TextInput
              label="Campaign sender address"
              description="Used only for campaigns, on its own subdomain."
              value={f.campaignSenderAddress}
              onChange={(e) => setF({ ...f, campaignSenderAddress: e.currentTarget.value })}
              error={save.fieldErrors.campaignSenderAddress}
            />
          </SimpleGrid>
          <Group>
            <Button type="submit" loading={save.pending}>
              Save email settings
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  );
}

// Space-only rules -------------------------------------------------------------------------

function SpaceOnlyForm({ editionId, initial }: { editionId: string; initial: SpaceOnlyRules }) {
  const [r, setR] = useState(initial);
  const save = useAction(updateSpaceOnlyRulesAction);
  const docOptions = SPACE_ONLY_DOCS.map((d) => ({ value: d.key, label: d.label }));
  return (
    <Paper withBorder p="lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.run(editionId, r);
        }}
      >
        <Stack>
          <Text fz="sm" c="dimmed">
            These rules decide which stands count as complex (and need structural calculations) and what every space-only pack must include.
          </Text>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <NumberInput label="Height limit (m)" description="Taller stands count as complex." value={r.maxHeightM} onChange={(v) => setR({ ...r, maxHeightM: Number(v || 0) })} min={1} max={30} decimalScale={2} />
            <NumberInput label="Platform limit (mm)" description="Higher platforms count as complex." value={r.maxPlatformMm} onChange={(v) => setR({ ...r, maxPlatformMm: Number(v || 0) })} min={0} max={5000} />
            <NumberInput
              label="Minimum insurance (£)"
              description="Contractor’s public liability cover."
              value={r.minInsuranceGbp}
              onChange={(v) => setR({ ...r, minInsuranceGbp: Number(v || 0) })}
              min={0}
              thousandSeparator=","
              prefix="£"
            />
          </SimpleGrid>
          <Checkbox label="Stands with steps or a second level count as complex" checked={r.stepsMakeComplex} onChange={(e) => setR({ ...r, stepsMakeComplex: e.currentTarget.checked })} />
          <MultiSelect label="Every pack must include" data={docOptions} value={r.requiredDocs} onChange={(v) => setR({ ...r, requiredDocs: v })} />
          <MultiSelect label="Complex stands must also include" data={docOptions} value={r.complexDocs} onChange={(v) => setR({ ...r, complexDocs: v })} />
          <Group>
            <Button type="submit" loading={save.pending}>
              Save rules
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  );
}
