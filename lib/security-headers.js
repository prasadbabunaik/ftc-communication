// Centralised security response headers. Applied in middleware so every
// response (page or API) gets the same baseline.
//
// What's set and why:
//
//   X-Content-Type-Options: nosniff
//     Stops browsers from guessing MIME types — mitigates content-sniffing
//     XSS where an uploaded .jpg actually contains <script>.
//
//   X-Frame-Options: DENY
//     Page can't be iframed by other origins. Clickjacking defence.
//
//   Referrer-Policy: strict-origin-when-cross-origin
//     Don't leak the full URL (which may contain query params with IDs) to
//     third-party origins via the Referer header.
//
//   Permissions-Policy: …
//     Browsers shut off APIs we don't use (camera, mic, geolocation, …).
//     Defence-in-depth against compromised third-party scripts.
//
//   Strict-Transport-Security (HTTPS only)
//     Tells browsers to refuse plaintext HTTP for this host for 2 years.
//     Only emitted when NODE_ENV=production AND the request looks HTTPS;
//     setting it on localhost-HTTP would brick the dev environment.
//
//   X-DNS-Prefetch-Control: on
//     Cosmetic perf win; lets the browser pre-resolve external hostnames
//     (e.g. google.com for reCAPTCHA).
//
//   Content-Security-Policy
//     Restricts where scripts/styles/frames may load from. Tuned for this app:
//     Next.js App Router ships inline hydration scripts and Tailwind ships
//     inline styles (hence 'unsafe-inline' for script/style), and the login
//     page loads Google reCAPTCHA v2 (www.google.com + www.gstatic.com script,
//     www.google.com frame). The strict, no-break directives — frame-ancestors,
//     base-uri, object-src, form-action — give real clickjacking/injection
//     hardening on top of that.

// Content-Security-Policy value. Kept as a single string; see header comment
// for the rationale behind each source list.
//
// In DEVELOPMENT only, Next.js's Fast Refresh / HMR runtime evaluates code with
// eval() and talks to the dev server over a WebSocket, so we add 'unsafe-eval'
// and ws:/wss: there. Production builds are pre-compiled and need NEITHER — the
// strict policy applies, so prod gets no eval and no websocket relaxation.
const IS_DEV = process.env.NODE_ENV !== 'production';
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${IS_DEV ? " 'unsafe-eval'" : ''} https://www.google.com https://www.gstatic.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://www.gstatic.com",
  "font-src 'self' data:",
  `connect-src 'self'${IS_DEV ? ' ws: wss:' : ''} https://www.google.com`,
  "frame-src https://www.google.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export const STATIC_SECURITY_HEADERS = {
  'X-Content-Type-Options':  'nosniff',
  'X-Frame-Options':         'DENY',
  'Referrer-Policy':         'strict-origin-when-cross-origin',
  'X-DNS-Prefetch-Control':  'on',
  'Content-Security-Policy':  CSP,
  // Disable APIs the portal doesn't need.
  'Permissions-Policy': [
    'accelerometer=()',
    'autoplay=()',
    'camera=()',
    'display-capture=()',
    'fullscreen=(self)',
    'geolocation=()',
    'gyroscope=()',
    'magnetometer=()',
    'microphone=()',
    'midi=()',
    'payment=()',
    'picture-in-picture=()',
    'usb=()',
    'xr-spatial-tracking=()',
  ].join(', '),
};

/**
 * Mutate a `NextResponse` (or any Headers-bearing response) in place with the
 * security header set. Returns the same response for chaining.
 */
export function applySecurityHeaders(response, request) {
  for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }

  // HSTS only when we're actually on HTTPS. The `x-forwarded-proto` header
  // is set by reverse proxies (Vercel, Cloudflare, nginx). Without HTTPS the
  // header is harmless but pointless; with localhost HTTP it can lock you
  // out of dev for two years if any browser caches it.
  const proto = request?.headers?.get?.('x-forwarded-proto');
  const isHttps = proto === 'https' || (request?.nextUrl?.protocol === 'https:');
  if (process.env.NODE_ENV === 'production' && isHttps) {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload',
    );
  }

  return response;
}
