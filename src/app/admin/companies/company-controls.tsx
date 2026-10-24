'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionIcon, Button, Group, Menu, Modal, Paper, Select, SimpleGrid, Stack, Switch, Textarea, TextInput, Title } from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconDots, IconPlus } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import { createCompanyAction, removeMemberAction, setInvoiceAllowedAction, setMemberAccessAction, updateCompanyAction } from '../actions';

export type CompanyFormValues = {
  name: string;
  website: string;
  email: string;
  phone: string;
  description: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  postcode: string;
  country: string;
  vatNumber: string;
  aspExhibitorId: string;
};

export const EMPTY_COMPANY: CompanyFormValues = {
  name: '',
  website: '',
  email: '',
  phone: '',
  description: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  postcode: '',
  country: 'United Kingdom',
  vatNumber: '',
  aspExhibitorId: '',
};

function CompanyFields({ f, setF, errors }: { f: CompanyFormValues; setF: (v: CompanyFormValues) => void; errors: Record<string, string> }) {
  const field = (key: keyof CompanyFormValues) => ({
    value: f[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [key]: e.currentTarget.value }),
    error: errors[key],
  });
  return (
    <Stack gap="sm">
      <TextInput label="Company name" required {...field('name')} />
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <TextInput label="Website" {...field('website')} />
        <TextInput label="General email" type="email" {...field('email')} />
        <TextInput label="Phone" {...field('phone')} />
        <TextInput label="VAT number" {...field('vatNumber')} />
      </SimpleGrid>
      <Textarea label="Description" autosize minRows={2} maxRows={6} {...field('description')} />
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <TextInput label="Address line 1" {...field('addressLine1')} />
        <TextInput label="Address line 2" {...field('addressLine2')} />
        <TextInput label="Town or city" {...field('city')} />
        <TextInput label="Postcode" {...field('postcode')} />
        <TextInput label="Country" {...field('country')} />
        <TextInput label="Event website exhibitor ID" description="Used to sync the profile to the show website." {...field('aspExhibitorId')} />
      </SimpleGrid>
    </Stack>
  );
}

export function NewCompanyButton() {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<CompanyFormValues>(EMPTY_COMPANY);
  const create = useAction(createCompanyAction);
  return (
    <>
      <Button leftSection={<IconPlus size={16} />} onClick={() => setOpen(true)}>
        New company
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title="New company" size="lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.run(f);
          }}
        >
          <Stack>
            <CompanyFields f={f} setF={setF} errors={create.fieldErrors} />
            <Group justify="flex-end">
              <Button type="submit" loading={create.pending}>
                Create company
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
}

export function CompanyDetailsForm({ companyId, initial }: { companyId: string; initial: CompanyFormValues }) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const save = useAction(updateCompanyAction, { onSuccess: () => router.refresh() });
  return (
    <Paper withBorder p="md">
      <Title order={3} fz="md" mb="sm">
        Company details
      </Title>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.run(companyId, f);
        }}
      >
        <Stack>
          <CompanyFields f={f} setF={setF} errors={save.fieldErrors} />
          <Group>
            <Button type="submit" loading={save.pending}>
              Save details
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  );
}

export function InvoiceSwitch({ companyId, allowed }: { companyId: string; allowed: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(allowed);
  const set = useAction(setInvoiceAllowedAction);
  return (
    <Switch
      label="Allow pay by invoice"
      description="Lets this company check out without a card. Orders wait for finance to raise an invoice."
      checked={value}
      disabled={set.pending}
      onChange={async (e) => {
        const next = e.currentTarget.checked;
        setValue(next);
        const res = await set.run(companyId, next);
        if (res.ok) router.refresh();
        else setValue(!next);
      }}
    />
  );
}

export function MemberMenu({ companyId, member }: { companyId: string; member: { userId: string; name: string; role: 'main_contact' | 'colleague'; canPay: boolean } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState(member.role);
  const [canPay, setCanPay] = useState(member.canPay);
  const save = useAction(setMemberAccessAction, { onSuccess: () => { setOpen(false); router.refresh(); } });
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
