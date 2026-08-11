import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@opsninja/ui-kit'],
  experimental: {
    reactCompiler: false,
  },
};

export default nextConfig;
