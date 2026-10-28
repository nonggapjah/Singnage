import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    serverActions: {
      bodySizeLimit: '2gb',
    },
    proxyClientMaxBodySize: '2gb',
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
    // The API the proxy forwards to. In production the API runs next to this app on 127.0.0.1:8862.
    // For local development against a remote API set API_UPSTREAM in .env.local (gitignored), e.g.
    // API_UPSTREAM=http://<api-host>:8862 -- server-side only, never exposed to the browser.
    const upstream = (process.env.API_UPSTREAM || 'http://127.0.0.1:8862').replace(/\/$/, '');
    return [
      {
        source: '/api/:path*',
        destination: `${upstream}/api/:path*` // Proxy to Backend
      },
      {
        source: '/media/:path*',
        destination: `${upstream}/media/:path*` // Proxy to Backend Static Files
      },
      {
        // Needed only while a 2.7.x API is deployed (static screenshot files). The 2.8 API serves
        // screenshots via GET /api/v1/devices/{id}/screenshot and answers 404 here, which is harmless.
        source: '/screenshots/:path*',
        destination: `${upstream}/screenshots/:path*`
      }
    ]
  }
};

export default nextConfig;
