import Link from 'next/link';
import { Stack } from '@mantine/core';
import { BrandMark } from './brand';
import { PlatformNotice } from './platform-notice';
import styles from './auth-card.module.css';

/** The frame for sign-in and the other short pages around it (two-factor, invitations, choosing a workspace). */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <a href="#content" className="skip-link">
        Skip to content
      </a>
      <header className={styles.header}>
        <Link href="/" className={styles.brandLink} aria-label="BluePrint home">
          <BrandMark size="md" />
        </Link>
        <Link href="/about" className={styles.headerLink}>
          About
        </Link>
      </header>
      <main id="content" className={styles.main} tabIndex={-1}>
        <div className={styles.column}>
          <PlatformNotice />
          <div className={styles.card}>
            <h1 className={styles.title}>{title}</h1>
            {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
            <Stack gap="md" className={styles.body}>
              {children}
            </Stack>
          </div>
          <p className={styles.foot}>BluePrint by Media10. Your information is protected and every change is logged.</p>
        </div>
      </main>
    </div>
  );
}
