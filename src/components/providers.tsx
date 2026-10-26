'use client';

import { useEffect } from 'react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { DatesProvider } from '@mantine/dates';
import 'dayjs/locale/en-gb';
import { cssVariablesResolver, theme } from '@/theme';

export function Providers({ children }: { children: React.ReactNode }) {
  // Marks the page as interactive (used by automated browser tests to avoid typing before React is ready).
  useEffect(() => {
    document.documentElement.dataset.ready = 'true';
  }, []);
  return (
    <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} defaultColorScheme="light" forceColorScheme="light">
      <DatesProvider settings={{ locale: 'en-gb', firstDayOfWeek: 1 }}>
        <ModalsProvider>
          <Notifications position="top-right" limit={4} />
          {children}
        </ModalsProvider>
      </DatesProvider>
    </MantineProvider>
  );
}
