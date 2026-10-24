'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@mantine/core';
import { IconMail } from '@tabler/icons-react';
import { useAction } from '@/lib/use-action';
import { emailStandsAction } from '../email-actions';

/** Starts an email to the stands listed (for example the ones most behind), for the team to write and send. */
export function EmailStandsButton({ editionId, standIds, label = 'Email them' }: { editionId: string; standIds: string[]; label?: string }) {
  const router = useRouter();
  const email = useAction(emailStandsAction, {
    onSuccess: (data) => {
      if (data?.id) router.push(`/manage/${editionId}/emails/campaigns/${data.id}`);
    },
  });
  return (
    <Button size="xs" variant="light" leftSection={<IconMail size={14} />} loading={email.pending} onClick={() => email.run(editionId, standIds)}>
      {label}
    </Button>
  );
}
