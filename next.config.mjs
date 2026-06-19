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
};

export default nextConfig;
