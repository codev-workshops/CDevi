import type { NextConfig } from 'next';

const API_ORIGIN = process.env['API_ORIGIN'] ?? 'http://localhost:3001';

// /api/* is proxied to the Fastify API so the session cookie is first-party (specs/003 research R1).
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Dev assets/HMR may be loaded through a local preview proxy on 127.0.0.1.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  transpilePackages: ['@cdevi/design-system', '@cdevi/contracts'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;
