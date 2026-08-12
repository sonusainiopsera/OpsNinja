import type { NextConfig } from 'next';

/**
 * Portal-specific CSP and security headers.
 * Stricter than the agent app: no unsafe-inline scripts, frame-ancestors none.
 * The theme pre-hydration script uses a nonce injected at request time.
 */
const SECURITY_HEADERS = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // Allow data: for inline image fallbacks (org initials avatars are CSS, not img)
      "img-src 'self' data: https:",
      // Fonts from self; Google Fonts explicitly excluded (portal is self-hosted)
      "font-src 'self'",
      // Scripts: self + nonce for the theme pre-hydration inline; no unsafe-inline
      "script-src 'self' 'nonce-PORTAL_NONCE'",
      // Styles: self only
      "style-src 'self' 'unsafe-inline'",
      // Portal connects only to its own API origin
      "connect-src 'self'",
      // Prevent framing
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
    ].join('; '),
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
];

const API_PROXY_TARGET = process.env['API_PROXY_TARGET'] ?? 'http://localhost:8080';

const nextConfig: NextConfig = {
  transpilePackages: ['@opsninja/ui-kit', '@opsninja/api-client'],
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${API_PROXY_TARGET}/api/v1/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        // Apply to all portal routes
        source: '/(.*)',
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
