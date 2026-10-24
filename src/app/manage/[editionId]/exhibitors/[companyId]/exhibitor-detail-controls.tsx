'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionIcon, Button, Checkbox, Group, Menu, Modal, Paper, Select, Stack, Switch, Text, Textarea, TextInput, Title } from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconDots, IconEye } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import { CompanyFields, type CompanyFormValues } from '@/components/company-fields';
import { removeMemberAction, setMemberAccessAction } from '@/app/admin/actions';
import { startViewAsAction } from '@/app/view-as-actions';
import { addNoteAction, deleteStandAction, inviteContactAction, setStandStatusAction, updateExhibitorCompanyAction, updateStandAction } from '../../../actions';
import { StandFields } from '../exhibitor-controls';

type Option = { value: string; label: string };
type StandValues = { number: string; exhibitorTypeId: string | null; hallId: string | null; sizeSqm: number | null; openSides: number; notes: string };

export function CompanyForm({ editionId, companyId, initial }: { editionId: string; companyId: string; initial: CompanyFormValues }) {
  const [f, setF] = useState(initial);
  const save = useAction(updateExhibitorCompanyAction);
  return (
    <Paper withBorder p="md">
      <Title order={2} fz="md" mb="sm">
        Company details
      </Title>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.run(editionId, companyId, f);
        }}
      >
        <Stack>
          <CompanyFields f={f} setF={setF} errors={save.fieldErrors} />
          <Text fz="xs" c="dimmed">
            The company keeps one record across every show, and its main contact can update it too.
          </Text>
          <Group>
            <Button type="submit" loading={save.pending}>
              Save company details
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  );
}

export function EditStandButton({ editionId, standId, initial, types, halls, status }: { editionId: string; standId: string; initial: StandValues; types: Option[]; halls: Option[]; status: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(initial);
  const save = useAction(updateStandAction, { onSuccess: () => setOpen(false) });
  const setStatus = useAction(setStandStatusAction);
  const del = useAction(deleteStandAction, { onSuccess: () => router.push(`/manage/${editionId}/stands`) });
  return (
    <>
      <Menu position="bottom-end">
        <Menu.Target>
          <ActionIcon variant="subtle" aria-label={`Change stand ${initial.number}`}>
            <IconDots size={16} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item onClick={() => setOpen(true)}>Edit stand</Menu.Item>
          {status === 'active' ? (
            <Menu.Item
              onClick={() =>
                modals.openConfirmModal({
                  title: `Cancel stand ${initial.number}?`,
                  children: <Text fz="sm">The company loses access to this stand’s tasks and shop. Orders and forms are kept, and you can restore it.</Text>,
                  labels: { confirm: 'Cancel stand', cancel: 'Keep it' },
                  confirmProps: { color: 'red' },
                  onConfirm: () => setStatus.run(editionId, standId, 'cancelled'),
                })
              }
            >
              Cancel stand
            </Menu.Item>
          ) : (
            <Menu.Item onClick={() => setStatus.run(editionId, standId, 'active')}>Restore stand</Menu.Item>
          )}
          <Menu.Item
            color="red"
            onClick={() =>
              modals.openConfirmModal({
                title: `Delete stand ${initial.number}?`,
                children: <Text fz="sm">Only for mistakes. Stands with orders or completed tasks can only be cancelled.</Text>,
                labels: { confirm: 'Delete', cancel: 'Keep it' },
                confirmProps: { color: 'red' },
                onConfirm: () => del.run(editionId, standId),
              })
            }
          >
            Delete stand
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <Modal opened={open} onClose={() => setOpen(false)} title={`Stand ${initial.number}`} size="lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.run(editionId, standId, { ...v, exhibitorTypeId: v.exhibitorTypeId ?? '', notes: v.notes || null });
          }}
        >
          <Stack>
            <StandFields value={v} onChange={setV} types={types} halls={halls} errors={save.fieldErrors} />
            <Group justify="flex-end">
              <Button type="submit" loading={save.pending}>
                Save stand
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
}

export function InviteContactForm({ editionId, companyId, hasMainContact, isDraft }: { editionId: string; companyId: string; hasMainContact: boolean; isDraft: boolean }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'main_contact' | 'colleague'>(hasMainContact ? 'colleague' : 'main_contact');
  const [sendNow, setSendNow] = useState(!isDraft);
  const invite = useAction(inviteContactAction, { onSuccess: () => setEmail('') });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        invite.run(editionId, companyId, { email, role, sendNow: sendNow && !isDraft });
      }}
    >
      <Stack gap="xs" mt="md">
        <Text fz="sm" fw={600}>
          Invite someone from this company
        </Text>
        <Group align="flex-end" gap="xs">
          <TextInput aria-label="Email address" placeholder="name@company.com" type="email" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} error={invite.fieldErrors.email} w={260} />
          <Select
            aria-label="Role"
            data={[
              { value: 'main_contact', label: 'Main contact' },
              { value: 'colleague', label: 'Colleague' },
            ]}
            value={role}
            onChange={(v) => v && setRole(v as typeof role)}
            allowDeselect={false}
            w={160}
          />
          <Button type="submit" loading={invite.pending}>
            {sendNow && !isDraft ? 'Send invitation' : 'Save invitation'}
          </Button>
        </Group>
        <Checkbox
          label="Send now"
          description={isDraft ? 'The show is a draft: the invitation is saved until the show goes live.' : undefined}
          checked={sendNow && !isDraft}
          disabled={isDraft}
          onChange={(e) => setSendNow(e.currentTarget.checked)}
          size="xs"
        />
      </Stack>
    </form>
  );
}

export function MemberActions({ companyId, member }: { companyId: string; member: { userId: string; name: string; role: 'main_contact' | 'colleague'; canPay: boolean } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState(member.role);
  const [canPay, setCanPay] = useState(member.canPay);
  const save = useAction(setMemberAccessAction, {
    onSuccess: () => {
      setOpen(false);
      router.refresh();
    },
  });
  const remove = useAction(removeMemberAction, { onSuccess: () => router.refresh() });
  return (
    <>
      <Menu position="bottom-end">
        <Menu.Target>
          <ActionIcon variant="subtle" aria-label={`Change access for ${member.name}`}>
            <IconDots size={16} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item onClick={() => setOpen(true)}>Change role</Menu.Item>
          <Menu.Item
            color="red"
            onClick={() =>
              modals.openConfirmModal({
                title: `Remove ${member.name} from the company?`,
                children: <Text fz="sm">They lose access to the company’s stands, tasks and orders.</Text>,
                labels: { confirm: 'Remove', cancel: 'Cancel' },
                confirmProps: { color: 'red' },
                onConfirm: () => remove.run(companyId, member.userId),
              })
            }
          >
            Remove from company
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <Modal opened={open} onClose={() => setOpen(false)} title={`Role for ${member.name}`}>
        <Stack>
          <Select
            label="Role"
            data={[
              { value: 'main_contact', label: 'Main contact (manages colleagues and contractors)' },
              { value: 'colleague', label: 'Colleague' },
            ]}
            value={role}
            onChange={(v) => v && setRole(v as typeof role)}
            allowDeselect={false}
          />
          <Switch label="Can place and pay for orders" checked={role === 'main_contact' || canPay} disabled={role === 'main_contact'} onChange={(e) => setCanPay(e.currentTarget.checked)} />
          <Group justify="flex-end">
            <Button loading={save.pending} onClick={() => save.run(companyId, member.userId, role, canPay)}>
              Save
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

export function NoteForm({ editionId, companyId }: { editionId: string; companyId: string }) {
  const [body, setBody] = useState('');
  const add = useAction(addNoteAction, { onSuccess: () => setBody('') });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        add.run(editionId, companyId, body);
      }}
    >
      <Stack gap="xs">
        <Textarea aria-label="New note" placeholder="Add a note for the team" autosize minRows={2} value={body} onChange={(e) => setBody(e.currentTarget.value)} maxLength={4000} />
        <Group>
          <Button type="submit" size="xs" variant="light" loading={add.pending} disabled={!body.trim()}>
            Add note
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

export function ViewAsButton({ editionId, members }: { editionId: string; members: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(members[0]?.id ?? null);
  const start = useAction(startViewAsAction);
  return (
    <>
      <Button variant="default" leftSection={<IconEye size={16} />} onClick={() => setOpen(true)}>
        See their portal
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title="See the portal as this exhibitor">
        <Stack>
          <Text fz="sm">You see exactly what they see, read-only. Nothing can be changed, and the view is recorded in the audit log.</Text>
          <Select label="Person" data={members.map((m) => ({ value: m.id, label: m.name }))} value={userId} onChange={setUserId} allowDeselect={false} />
          <Group justify="flex-end">
            <Button loading={start.pending} disabled={!userId} onClick={() => userId && start.run(userId, editionId)}>
              Open their portal
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
