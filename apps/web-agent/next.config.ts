import type { NextConfig } from 'next';

const API_PROXY_TARGET = process.env['API_PROXY_TARGET'] ?? 'http://localhost:8080';

const nextConfig: NextConfig = {
  transpilePackages: ['@opsninja/ui-kit', '@opsninja/filter-compiler', '@opsninja/api-client'],
  experimental: {
    typedRoutes: true,
  },
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${API_PROXY_TARGET}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
