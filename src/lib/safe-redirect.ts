/**
 * A path on this site, or null. The value is read the way a browser would read it (browsers drop
 * tabs and line breaks and treat "\" as "/"), so tricks such as "/\t/evil.example" cannot turn a
 * "go back to where you were" link into a jump to another website.
 */
export function localPath(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string' || value.length > 500) return null;
  // Our own paths never contain control characters or backslashes.
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  const base = 'https://blueprint.invalid';
  try {
    const u = new URL(value, base);
    if (u.origin !== base) return null;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return null;
  }
}

/**
 * Where the browser may be sent after starting a payment or Stripe set-up: a path on this site,
 * or Stripe's own hosted pages. Anything else is refused, so a tampered response cannot send
 * someone to a look-alike payment page.
 */
export function isAllowedPaymentRedirect(url: string | null | undefined): url is string {
  if (!url) return false;
  if (localPath(url) !== null) return true;
  if (/[\u0000-\u001f\u007f\\]/.test(url)) return false;
  try {
    const u = new URL(url);
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.port &&
      ['checkout.stripe.com', 'connect.stripe.com', 'dashboard.stripe.com'].includes(u.hostname)
    );
  } catch {
    return false;
  }
}
