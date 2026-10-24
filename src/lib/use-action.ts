'use client';

import { useCallback, useState, useTransition } from 'react';
import { notifications } from '@mantine/notifications';
import type { ActionResult } from './action-result';

type Options<T> = {
  onSuccess?: (data: T | undefined) => void;
  successMessage?: string;
  /** Show a red notification on failure (default true). */
  notifyErrors?: boolean;
};

/** Runs a server action inside a transition and surfaces its result as notifications and field errors. */
export function useAction<A extends unknown[], T>(action: (...args: A) => Promise<ActionResult<T> | undefined | void>, opts: Options<T> = {}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const { onSuccess, successMessage, notifyErrors = true } = opts;

  const run = useCallback(
    (...args: A) =>
      new Promise<ActionResult<T>>((resolve) => {
        startTransition(async () => {
          const res = (await action(...args)) ?? ({ ok: true } as ActionResult<T>);
          if (res.ok) {
            setError(null);
            setFieldErrors({});
            const msg = res.message ?? successMessage;
            if (msg) notifications.show({ color: 'green', message: msg });
            onSuccess?.(res.data);
          } else {
            setError(res.error);
            setFieldErrors(res.fieldErrors ?? {});
            if (notifyErrors) notifications.show({ color: 'red', title: 'Not done', message: res.error });
          }
          resolve(res);
        });
      }),
    [action, onSuccess, successMessage, notifyErrors],
  );

  return { run, pending, error, fieldErrors, setError };
}
