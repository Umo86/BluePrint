'use client';

import { useState } from 'react';
import { Alert, Button } from '@mantine/core';
import { useAction } from '@/lib/use-action';
import { unsubscribeAction } from './actions';

export function UnsubscribeButton({ token }: { token: string }) {
  const [done, setDone] = useState(false);
  const act = useAction(unsubscribeAction, { onSuccess: () => setDone(true) });
  if (done) return <Alert color="green">Done. You will not get show updates by email any more. Emails about your own deadlines and orders still arrive.</Alert>;
  return (
    <Button loading={act.pending} onClick={() => act.run(token)}>
      Unsubscribe
    </Button>
  );
}
