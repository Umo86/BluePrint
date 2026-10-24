import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Server-only packages that must not be bundled (native binaries, WASM or large Node libraries).
  serverExternalPackages: [
    '@electric-sql/pglite',
    '@node-rs/argon2',
    'pg',
    'mjml',
    'exceljs',
    'pdf-lib',
    'sanitize-html',
  ],
  experimental: {
    serverActions: {
      // Uploads go through dedicated route handlers; actions carry form data only.
      bodySizeLimit: '2mb',
    },
  },
  images: {
    // Branding images and product photos are served by our own file route.
    remotePatterns: [],
  },
  async headers() {
    const securityHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      { key: 'X-DNS-Prefetch-Control', value: 'off' },
    ];
    if (process.env.NODE_ENV === 'production') {
      securityHeaders.push({ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' });
    }
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
