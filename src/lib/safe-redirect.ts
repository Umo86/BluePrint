/**
 * Where the browser may be sent after starting a payment or Stripe set-up: a path on this site,
 * or Stripe's own hosted pages. Anything else is refused, so a tampered response cannot send
 * someone to a look-alike payment page.
 */
export function isAllowedPaymentRedirect(url: string | null | undefined): url is string {
  if (!url) return false;
  if (url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\')) return true;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ['checkout.stripe.com', 'connect.stripe.com', 'dashboard.stripe.com'].includes(u.hostname);
  } catch {
    return false;
  }
}
