'use client';

import Link from 'next/link';
import { Anchor, Button, type AnchorProps, type ButtonProps } from '@mantine/core';

/** A Mantine link that navigates client-side. Safe to use from server components. */
export function TextLink({ href, children, ...rest }: AnchorProps & { href: string; children: React.ReactNode; title?: string }) {
  return (
    <Anchor component={Link} href={href} {...rest}>
      {children}
    </Anchor>
  );
}

export function ButtonLink({ href, children, ...rest }: ButtonProps & { href: string; children: React.ReactNode }) {
  return (
    <Button component={Link} href={href} {...rest}>
      {children}
    </Button>
  );
}

/** A button that downloads a file from a route handler (a full request, not client navigation). */
export function DownloadButton({ href, children, ...rest }: ButtonProps & { href: string; children: React.ReactNode }) {
  return (
    <Button component="a" href={href} {...rest}>
      {children}
    </Button>
  );
}
