'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Badge, Tabs } from '@mantine/core';

/** The AI assistant section's tabs; the chosen tab is kept in the address so it can be linked to. */
export function AssistantTabs({ panels, initialTab }: { panels: { value: string; label: string; badge?: number; content: React.ReactNode }[]; initialTab: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState(initialTab);
  return (
    <Tabs
      value={tab}
      onChange={(v) => {
        if (!v) return;
        setTab(v);
        router.replace(`${pathname}?tab=${v}`, { scroll: false });
      }}
    >
      <Tabs.List mb="md">
        {panels.map((p) => (
          <Tabs.Tab
            key={p.value}
            value={p.value}
            rightSection={
              p.badge ? (
                <Badge size="xs" variant="light" color="orange" circle>
                  {p.badge}
                </Badge>
              ) : null
            }
          >
            {p.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {panels.map((p) => (
        <Tabs.Panel key={p.value} value={p.value}>
          {p.content}
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}
