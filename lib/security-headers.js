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
// Content-Security-Policy is intentionally NOT set here yet — a meaningful
// CSP needs careful per-route tuning (Next.js inline scripts, reCAPTCHA's
// google.com domains, Tailwind's inline styles). Adding it as a follow-up
// once we've audited the script surface; locking it down wrong will silently
// break the dashboard.

export const STATIC_SECURITY_HEADERS = {
  'X-Content-Type-Options':  'nosniff',
  'X-Frame-Options':         'DENY',
  'Referrer-Policy':         'strict-origin-when-cross-origin',
  'X-DNS-Prefetch-Control':  'on',
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
