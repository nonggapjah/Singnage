import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    serverActions: {
      bodySizeLimit: '2gb',
    },
    proxyClientMaxBodySize: '2gb',
  },
  env: {
    NEXT_PUBLIC_DEBUG: '1', // Set to '0' for Production
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:8862/api/:path*' // Proxy to Backend
      },
      {
        source: '/media/:path*',
        destination: 'http://localhost:8862/media/:path*' // Proxy to Backend Static Files
      }
    ]
  }
};

export default nextConfig;
