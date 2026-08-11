import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@opsninja/ui-kit', '@opsninja/filter-compiler'],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
