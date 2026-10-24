'use client';

import { useState } from 'react';
import { Button, Group, Paper, Stack, TextInput } from '@mantine/core';
import { useAction } from '@/lib/use-action';
import { updateSupplierDetailsAction } from '../../actions';

export function SupplierDetailsForm({ supplierId, initial, editable }: { supplierId: string; initial: { name: string; email: string; phone: string; website: string }; editable: boolean }) {
  const [v, setV] = useState(initial);
  const save = useAction(updateSupplierDetailsAction);
  return (
    <Paper withBorder p="md" maw={640}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.run(supplierId, { name: v.name, email: v.email, phone: v.phone || null, website: v.website || null });
        }}
      >
        <Stack>
          <TextInput label="Business name" value={v.name} onChange={(e) => setV({ ...v, name: e.currentTarget.value })} error={save.fieldErrors.name} required disabled={!editable} maxLength={200} />
          <TextInput
            label="Orders email"
            description="New orders and approvals are emailed here as well as to everyone with a login."
            type="email"
            value={v.email}
            onChange={(e) => setV({ ...v, email: e.currentTarget.value })}
            error={save.fieldErrors.email}
            required
            disabled={!editable}
          />
          <TextInput label="Phone" value={v.phone} onChange={(e) => setV({ ...v, phone: e.currentTarget.value })} disabled={!editable} maxLength={40} />
          <TextInput label="Website" value={v.website} onChange={(e) => setV({ ...v, website: e.currentTarget.value })} disabled={!editable} maxLength={300} />
          {editable ? (
            <Group>
              <Button type="submit" loading={save.pending}>
                Save
              </Button>
            </Group>
          ) : null}
        </Stack>
      </form>
    </Paper>
  );
}
