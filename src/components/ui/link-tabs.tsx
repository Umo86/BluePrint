'use client';

import Link from 'next/link';
import { Badge, Tabs } from '@mantine/core';

/** Tabs that are links (the selected tab lives in the address, so it survives refreshes and can be shared). */
export function LinkTabs({ tabs, value }: { tabs: { value: string; label: string; href: string; count?: number | null }[]; value: string }) {
  return (
    <Tabs value={value}>
      <Tabs.List>
        {tabs.map((t) => (
          <Tabs.Tab
            key={t.value}
            value={t.value}
            renderRoot={(props) => <Link {...props} href={t.href} />}
            rightSection={
              t.count ? (
                <Badge size="xs" color="yellow" circle>
                  {t.count}
                </Badge>
              ) : null
            }
          >
            {t.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
    </Tabs>
  );
}
