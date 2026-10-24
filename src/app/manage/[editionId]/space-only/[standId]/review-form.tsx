'use client';

import { useState } from 'react';
import { Button, Group, Paper, SegmentedControl, Select, Stack, Text, Textarea, Title } from '@mantine/core';
import { useAction } from '@/lib/use-action';
import { reviewPackAction } from '@/app/space-only-actions';

type Decision = 'comment' | 'approved' | 'approved_with_conditions' | 'changes_needed' | 'rejected';

export function ReviewForm({ standId, status, docOptions }: { standId: string; status: string; docOptions: { value: string; label: string }[] }) {
  const [decision, setDecision] = useState<Decision>('comment');
  const [comment, setComment] = useState('');
  const [conditions, setConditions] = useState('');
  const [docType, setDocType] = useState<string | null>(null);
  const review = useAction(reviewPackAction, {
    onSuccess: () => {
      setComment('');
      setConditions('');
      setDocType(null);
      setDecision('comment');
    },
  });
  const start = useAction(reviewPackAction);
  return (
    <Paper withBorder p="md">
      <Title order={2} fz="md" mb="sm">
        Your review
      </Title>
      <Stack gap="sm">
        {status === 'submitted' ? (
          <Button variant="light" size="xs" loading={start.pending} onClick={() => start.run(standId, { decision: 'under_review' })} style={{ alignSelf: 'flex-start' }}>
            Mark as being reviewed
          </Button>
        ) : null}
        <SegmentedControl
          orientation="vertical"
          fullWidth
          value={decision}
          onChange={(v) => setDecision(v as Decision)}
          data={[
            { value: 'comment', label: 'Comment only' },
            { value: 'approved', label: 'Approve' },
            { value: 'approved_with_conditions', label: 'Approve with conditions' },
            { value: 'changes_needed', label: 'Ask for changes' },
            { value: 'rejected', label: 'Do not approve' },
          ]}
        />
        {decision === 'approved_with_conditions' ? (
          <Textarea label="Conditions" description="Printed on the permission-to-build certificate." autosize minRows={2} value={conditions} onChange={(e) => setConditions(e.currentTarget.value)} error={review.fieldErrors.conditions} />
        ) : null}
        <Select label="About a document (optional)" data={docOptions} value={docType} onChange={setDocType} clearable />
        <Textarea
          label={decision === 'comment' ? 'Comment' : 'Note to the exhibitor and contractor'}
          description={decision === 'changes_needed' || decision === 'rejected' ? 'Required. They receive it by email.' : undefined}
          autosize
          minRows={3}
          value={comment}
          onChange={(e) => setComment(e.currentTarget.value)}
          error={review.fieldErrors.comment}
        />
        <Group>
          <Button
            color={decision.startsWith('approved') ? 'green' : decision === 'rejected' ? 'red' : decision === 'changes_needed' ? 'orange' : undefined}
            loading={review.pending}
            onClick={() => review.run(standId, { decision, comment, conditions, docType })}
          >
            {decision === 'comment' ? 'Add comment' : 'Save decision'}
          </Button>
        </Group>
        {decision.startsWith('approved') ? (
          <Text fz="xs" c="dimmed">
            Approving creates the permission-to-build certificate and emails the exhibitor and contractor.
          </Text>
        ) : null}
      </Stack>
    </Paper>
  );
}
