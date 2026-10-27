import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/dropzone/styles.css';
import '@mantine/tiptap/styles.css';
// Typefaces, served from this site (no third-party font requests): Host Grotesk for text, Aleo for
// titles, Azeret Mono for buttons on the public pages and code.
import '@fontsource-variable/host-grotesk/wght.css';
import '@fontsource-variable/host-grotesk/wght-italic.css';
import '@fontsource-variable/aleo/wght.css';
import '@fontsource-variable/azeret-mono/wght.css';
import './globals.css';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { mantineHtmlProps } from '@mantine/core';
import { Providers } from '@/components/providers';
import { storageMode } from '@/server/env';

export const metadata: Metadata = {
  title: { default: 'BluePrint', template: '%s · BluePrint' },
  description: 'The exhibitor manual and service-ordering platform for exhibition organisers.',
  robots: { index: false, follow: false },
};

// BluePrint always uses the light colour scheme, so Mantine's colour-scheme script (an inline
// script) is not needed: the attribute is set on <html> by mantineHtmlProps.
export default async function RootLayout({ children }: LayoutProps<'/'>) {
  // Every page is rendered per request, so each one gets a fresh CSP nonce (see proxy.ts).
  // A page built ahead of time would have no nonce and its scripts would be blocked.
  await connection();
  return (
    <html lang="en-GB" {...mantineHtmlProps}>
      <body>
        {/* Upload areas say so up front when file storage is switched off, rather than failing on use. */}
        <Providers uploadsOn={storageMode() !== 'off'}>{children}</Providers>
      </body>
    </html>
  );
}
