'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SegmentedControl } from '@mantine/core';

export function QueueFilter({ counts }: { counts: { review: number; chase: number; all: number } }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <SegmentedControl
      value={params.get('view') ?? 'review'}
      onChange={(v) => router.push(v === 'review' ? pathname : `${pathname}?view=${v}`)}
      data={[
        { value: 'review', label: `To review (${counts.review})` },
        { value: 'chase', label: `To chase (${counts.chase})` },
        { value: 'all', label: `All (${counts.all})` },
      ]}
      style={{ alignSelf: 'flex-start' }}
    />
  );
}
