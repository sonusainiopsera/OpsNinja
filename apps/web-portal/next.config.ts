import type { NextConfig } from 'next';
import crypto from 'node:crypto';

// Generate a per-build nonce for inline scripts (theme pre-hydration).
// In production this would be per-request via middleware; for config-level
// headers we use a static nonce that gets regenerated on each build/deploy.
const buildNonce = crypto.randomBytes(16).toString('base64');

const ContentSecurityPolicy = [
  `default-src 'self'`,
  `script-src 'self' 'nonce-${buildNonce}'`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob: https:`,
  `font-src 'self' data:`,
  `connect-src 'self'`,
  `frame-ancestors 'none'`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: ContentSecurityPolicy },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'geolocation=(), camera=(), microphone=()' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
];

const nextConfig: NextConfig = {
  transpilePackages: ['@opsninja/ui-kit'],
  experimental: {
    reactCompiler: false,
  },
  async headers() {
    return [
      {
        // Apply security headers to all portal routes
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
