import Link from 'next/link';
import styles from './site.module.css';

/** A call to action on the public pages: solid black or outlined, with the corner cut off. */
export function CtaLink({
  href,
  children,
  variant = 'solid',
  size = 'md',
  onDark = false,
}: {
  href: string;
  children: React.ReactNode;
  variant?: 'solid' | 'ghost';
  size?: 'sm' | 'md';
  onDark?: boolean;
}) {
  const className = [styles.btn, variant === 'solid' ? styles.solid : styles.ghost, size === 'sm' ? styles.btnSmall : '', onDark ? styles.onDark : '']
    .filter(Boolean)
    .join(' ');
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
