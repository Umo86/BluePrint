'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionIcon, Button, Checkbox, Group, Menu, Modal, Paper, Select, Stack, Switch, Text, TextInput, Title } from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconDots } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import { CompanyFields, type CompanyFormValues } from '@/components/company-fields';
import { removeMemberAction, setMemberAccessAction } from '@/app/admin/actions';
import { inviteColleagueAction, updateMyCompanyAction } from '../../actions';

export function MyCompanyForm({ slug, companyId, initial, readOnly }: { slug: string; companyId: string; initial: CompanyFormValues; readOnly: boolean }) {
  const [f, setF] = useState(initial);
  const save = useAction(updateMyCompanyAction);
  return (
    <Paper withBorder p="md">
      <Title order={2} fz="md" mb="sm">
        Company details
      </Title>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!readOnly) save.run(slug, companyId, f);
        }}
      >
        <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0 }}>
          <Stack>
            <CompanyFields f={f} setF={setF} errors={save.fieldErrors} />
            {!readOnly ? (
              <Group>
                <Button type="submit" loading={save.pending}>
                  Save company details
                </Button>
              </Group>
            ) : null}
          </Stack>
        </fieldset>
      </form>
    </Paper>
  );
}

export function InviteColleague({ slug, standId }: { slug: string; standId: string }) {
  const [email, setEmail] = useState('');
  const [canPay, setCanPay] = useState(false);
  const invite = useAction(inviteColleagueAction, { onSuccess: () => setEmail('') });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        invite.run(slug, standId, email, canPay);
      }}
    >
      <Stack gap="xs" mt="md">
        <Text fz="sm" fw={600}>
          Invite a colleague
        </Text>
        <Group align="flex-end" gap="xs">
          <TextInput aria-label="Colleague's email" placeholder="colleague@yourcompany.com" type="email" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} error={invite.fieldErrors.email} w={280} />
          <Button type="submit" loading={invite.pending}>
            Send invitation
          </Button>
        </Group>
        <Checkbox label="They can place and pay for orders" checked={canPay} onChange={(e) => setCanPay(e.currentTarget.checked)} size="xs" />
      </Stack>
    </form>
  );
}

export function PersonActions({ companyId, person }: { companyId: string; person: { userId: string; name: string; role: 'main_contact' | 'colleague'; canPay: boolean } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState(person.role);
  const [canPay, setCanPay] = useState(person.canPay);
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
          <ActionIcon variant="subtle" aria-label={`Change access for ${person.name}`}>
            <IconDots size={16} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item onClick={() => setOpen(true)}>Change role</Menu.Item>
          <Menu.Item
            color="red"
            onClick={() =>
              modals.openConfirmModal({
                title: `Remove ${person.name}?`,
                children: <Text fz="sm">They will no longer be able to see your stand, tasks or orders.</Text>,
                labels: { confirm: 'Remove', cancel: 'Cancel' },
                confirmProps: { color: 'red' },
                onConfirm: () => remove.run(companyId, person.userId),
              })
            }
          >
            Remove
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <Modal opened={open} onClose={() => setOpen(false)} title={`Role for ${person.name}`}>
        <Stack>
          <Select
            label="Role"
            data={[
              { value: 'main_contact', label: 'Main contact (manages the team and contractors)' },
              { value: 'colleague', label: 'Colleague' },
            ]}
            value={role}
            onChange={(v) => v && setRole(v as typeof role)}
            allowDeselect={false}
          />
          <Switch label="Can place and pay for orders" checked={role === 'main_contact' || canPay} disabled={role === 'main_contact'} onChange={(e) => setCanPay(e.currentTarget.checked)} />
          <Group justify="flex-end">
            <Button loading={save.pending} onClick={() => save.run(companyId, person.userId, role, canPay)}>
              Save
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
