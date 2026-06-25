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
    NEXT_PUBLIC_DEBUG: '1', // Set to '1' for Development
  },
  async headers() {
    return [
      {
        // The service worker script must never be cached long, otherwise SW updates
        // (e.g. cache-strategy fixes) take hours to reach clients. Always revalidate.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://127.0.0.1:8862/api/:path*' // Proxy to Backend
      },
      {
        source: '/media/:path*',
        destination: 'http://127.0.0.1:8862/media/:path*' // Proxy to Backend Static Files
      },
      {
        source: '/screenshots/:path*',
        destination: 'http://127.0.0.1:8862/screenshots/:path*' // Proxy to Backend Screenshots
      }
    ]
  }
};

export default nextConfig;
