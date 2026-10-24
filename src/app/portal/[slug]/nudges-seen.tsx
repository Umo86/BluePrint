'use client';

import { useEffect, useRef } from 'react';
import { nudgesSeenAction } from '../help-actions';

/** Once the reminders have been shown, records them so the same step is not shown again. */
export function NudgesSeen({ standId, items }: { standId: string; items: { taskId: string; step: string }[] }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !items.length) return;
    done.current = true;
    void nudgesSeenAction(standId, items);
  }, [standId, items]);
  return null;
}
