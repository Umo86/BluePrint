'use client';

import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { DatesProvider } from '@mantine/dates';
import 'dayjs/locale/en-gb';
import { theme } from '@/theme';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MantineProvider theme={theme} defaultColorScheme="light">
      <DatesProvider settings={{ locale: 'en-gb', firstDayOfWeek: 1 }}>
        <ModalsProvider>
          <Notifications position="top-right" limit={4} />
          {children}
        </ModalsProvider>
      </DatesProvider>
    </MantineProvider>
  );
}
