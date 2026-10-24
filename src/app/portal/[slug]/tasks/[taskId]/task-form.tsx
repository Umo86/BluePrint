'use client';

import { useState } from 'react';
import { Alert, Button, Group, Stack, Text } from '@mantine/core';
import { FormRenderer, type FileInfo } from '@/components/form-renderer';
import { useAction } from '@/lib/use-action';
import { validateAnswers, type FormField } from '@/lib/forms';
import { markTaskAction, saveAnswersAction } from '../../../actions';

export function TaskForm({
  slug,
  standId,
  taskId,
  fields,
  initial,
  files: initialFiles,
  editable,
  alreadySent,
  requiresApproval,
}: {
  slug: string;
  standId: string;
  taskId: string;
  fields: FormField[];
  initial: Record<string, unknown>;
  files: FileInfo;
  editable: boolean;
  alreadySent: boolean;
  requiresApproval: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [files, setFiles] = useState(initialFiles);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useAction(saveAnswersAction, {
    onSuccess: () => setErrors({}),
  });
  const submit = () => {
    // Check in the browser first for instant feedback; the server checks again.
    const check = validateAnswers(fields, value, { submit: true });
    if (!check.ok) {
      setErrors(check.errors);
      return;
    }
    save.run(slug, standId, taskId, value, true).then((r) => {
      if (!r.ok && r.fieldErrors) setErrors(r.fieldErrors);
    });
  };
  return (
    <Stack>
      <FormRenderer
        fields={fields}
        value={value}
        onChange={setValue}
        errors={{ ...errors, ...save.fieldErrors }}
        readOnly={!editable}
        standId={standId}
        files={files}
        onFileUploaded={(id, info) => setFiles((f) => ({ ...f, [id]: info }))}
      />
      {Object.keys(errors).length ? <Alert color="red">Please answer the highlighted questions.</Alert> : null}
      {editable ? (
        <Group>
          <Button onClick={submit} loading={save.pending}>
            {alreadySent ? 'Send changes' : requiresApproval ? 'Send for approval' : 'Submit'}
          </Button>
          {!alreadySent ? (
            <Button variant="default" onClick={() => save.run(slug, standId, taskId, value, false)} loading={save.pending}>
              Save and finish later
            </Button>
          ) : null}
        </Group>
      ) : null}
      {editable && requiresApproval ? (
        <Text fz="xs" c="dimmed">
          The show team checks this and lets you know if anything needs changing.
        </Text>
      ) : null}
    </Stack>
  );
}

export function TaskMarkButtons({ slug, standId, taskId, mode, done, editable }: { slug: string; standId: string; taskId: string; mode: 'info' | 'not_needed' | 'undo'; done: boolean; editable: boolean }) {
  const mark = useAction(markTaskAction);
  if (!editable) return null;
  if (mode === 'info') {
    return done ? (
      <Button variant="subtle" onClick={() => mark.run(slug, standId, taskId, 'undo')} loading={mark.pending} style={{ alignSelf: 'flex-start' }}>
        Mark as not read
      </Button>
    ) : (
      <Button onClick={() => mark.run(slug, standId, taskId, 'read')} loading={mark.pending} style={{ alignSelf: 'flex-start' }}>
        I have read this
      </Button>
    );
  }
  if (mode === 'undo') {
    return (
      <Button variant="subtle" onClick={() => mark.run(slug, standId, taskId, 'undo')} loading={mark.pending} style={{ alignSelf: 'flex-start' }}>
        Actually, this does apply to us
      </Button>
    );
  }
  return (
    <Button variant="subtle" color="gray" onClick={() => mark.run(slug, standId, taskId, 'not_needed')} loading={mark.pending} style={{ alignSelf: 'flex-start' }}>
      This does not apply to us
    </Button>
  );
}
