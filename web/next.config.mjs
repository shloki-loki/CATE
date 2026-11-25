/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: '20mb' } },
  async redirects() {
    return [
      { source: '/log', destination: '/logs', permanent: false },
      { source: '/tasks', destination: '/', permanent: false },
      { source: '/agents', destination: '/models', permanent: false },
      { source: '/task/:id', destination: '/logs', permanent: false },
    ];
  },
  async headers() {
    // Private tool: keep it out of search engines and other sites' frames.
    return [{ source: '/(.*)', headers: [
      { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
    ] }];
  },
};
export default nextConfig;
