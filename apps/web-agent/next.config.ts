import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@opsninja/ui-kit'],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
