import Link from 'next/link';
import { BrandMark } from '@/components/brand';
import { CtaLink } from './cta-link';
import styles from './site.module.css';

/** The bar at the top of the public pages. Someone already signed in gets a way back into BluePrint. */
export function SiteHeader({ signedIn, current }: { signedIn: boolean; current?: 'home' | 'about' }) {
  return (
    <header className={styles.header}>
      <div className={`${styles.container} ${styles.headerInner}`}>
        <Link href="/" className={styles.brandLink} aria-label="BluePrint home" aria-current={current === 'home' ? 'page' : undefined}>
          <BrandMark size="md" />
        </Link>
        <nav aria-label="Main" className={styles.nav}>
          <Link href="/about" className={styles.navLink} aria-current={current === 'about' ? 'page' : undefined}>
            About
          </Link>
          {signedIn ? (
            <CtaLink href="/start" size="sm">
              Open BluePrint
            </CtaLink>
          ) : (
            <CtaLink href="/sign-in" size="sm">
              Sign in
            </CtaLink>
          )}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={`${styles.container} ${styles.footerInner}`}>
        <div className={styles.footerBrand}>
          <BrandMark size="md" tone="white" />
          <p style={{ margin: 0 }}>The exhibitor manual and service-ordering platform for Media10 shows.</p>
        </div>
        <nav aria-label="Footer">
          <ul className={styles.footerLinks}>
            <li>
              <Link href="/">Home</Link>
            </li>
            <li>
              <Link href="/about">About</Link>
            </li>
            <li>
              <Link href="/sign-in">Sign in</Link>
            </li>
          </ul>
        </nav>
      </div>
      <div className={`${styles.container} ${styles.footerSmall}`}>BluePrint is made and run by Media10.</div>
    </footer>
  );
}

/** The frame shared by the public pages. */
export function SitePage({ signedIn, current, children }: { signedIn: boolean; current?: 'home' | 'about'; children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <a href="#content" className="skip-link">
        Skip to content
      </a>
      <SiteHeader signedIn={signedIn} current={current} />
      <main id="content" className={styles.main} tabIndex={-1}>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
