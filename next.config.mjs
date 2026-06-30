/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['bcryptjs'],
  // Don't advertise the framework (minor information-disclosure hardening).
  poweredByHeader: false,
  // The app sits behind a reverse proxy that forwards x-forwarded-host as the
  // internal address (10.5.134.209:3003) while the browser origin is the public
  // domain. Next.js 15's Server-Actions CSRF check rejects that mismatch, so we
  // explicitly trust the real origins the app is served from.
  experimental: {
    serverActions: {
      allowedOrigins: [
        'ftc-communication.grid-india.in',
        '10.5.134.209:3003',
        'localhost:3003',
      ],
    },
  },
  // The login page is statically prerendered, which makes Next emit
  // `Cache-Control: s-maxage=31536000` — a shared cache (the nginx layer) would
  // then hold it for a year. It's the auth entry point, so keep it out of shared
  // caches (also ensures security/login changes propagate immediately).
  async headers() {
    return [
      {
        source: '/login',
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0, must-revalidate' }],
      },
    ];
  },
};

export default nextConfig;
