'use client';

import { SimpleGrid, Stack, Textarea, TextInput } from '@mantine/core';

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

export function CompanyFields({ f, setF, errors }: { f: CompanyFormValues; setF: (v: CompanyFormValues) => void; errors: Record<string, string> }) {
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

