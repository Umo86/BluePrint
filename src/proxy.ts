import { NextResponse, type NextRequest } from 'next/server';

/**
 * Adds a per-request nonce-based Content Security Policy to every page.
 * Scripts only run if Next.js (or our own code) stamped them with this request's nonce.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';
  // Uploads go straight from the browser to Cloudflare R2 with a short-lived signed URL.
  const uploadOrigin = process.env.STORAGE_PROVIDER === 'r2' && process.env.R2_ACCOUNT_ID ? ` https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '';

  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    // Mantine sets CSS variables through style attributes, which nonces cannot cover.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src 'self'${uploadOrigin}${isDev ? ' ws: wss:' : ''}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  // Lets server components send people back to the page they asked for after signing in.
  requestHeaders.set('x-pathname', request.nextUrl.pathname + request.nextUrl.search);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: API routes and file downloads set their own headers.
      source: '/((?!api|files/|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
