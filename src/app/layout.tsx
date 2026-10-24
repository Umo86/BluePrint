import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/dropzone/styles.css';
import '@mantine/tiptap/styles.css';
import './globals.css';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { ColorSchemeScript, mantineHtmlProps } from '@mantine/core';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: { default: 'BluePrint', template: '%s · BluePrint' },
  description: 'The Media10 exhibitor manual and service ordering platform.',
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="en-GB" {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript nonce={nonce} defaultColorScheme="light" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
