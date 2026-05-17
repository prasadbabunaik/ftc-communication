// In-memory sliding-window rate limiter.
//
// Scope: works for single-instance deployments (typical Next.js standalone
// server). If you scale horizontally or move to serverless functions with
// cold starts, swap this out for a shared store — Upstash Redis is the most
// common pick. The API surface (`rateLimit`, `recordFailure`, `clearFailures`)
// is intentionally narrow so the swap is a one-file change.
//
// Two distinct concepts live here:
//
// 1. `rateLimit(key, opts)` — generic sliding-window throttle. Tracks request
//    timestamps per key, blocks once the count in the window exceeds the
//    limit. Use for "max N requests per minute" cases like login attempts.
//
// 2. `recordFailure(key)` / `failureCount(key)` / `clearFailures(key)` — a
//    separate failure-only counter with its own decay, used for account
//    lockout: increment on bad password, reset on success. Independent from
//    the request-throttle counter so a successful login doesn't reset the
//    IP-level rate limit.

const REQUESTS    = new Map();  // key → [timestamp, timestamp, …]
const FAILURES    = new Map();  // key → { count, firstAt, lastAt }
const FAILURE_TTL_MS = 30 * 60 * 1000;  // failures decay after 30 min idle

// ── Generic sliding window ─────────────────────────────────────────────────────

/**
 * Check if a request under `key` is allowed under a sliding-window policy.
 * Returns { ok, remaining, retryAfterSec }. When ok is false, callers should
 * respond with 429 and include `Retry-After: retryAfterSec`.
 *
 * @param {string} key       Bucket key (e.g. "login:ip:1.2.3.4")
 * @param {object} opts
 * @param {number} opts.limit  Max requests per window
 * @param {number} opts.windowMs  Window duration in ms
 */
export function rateLimit(key, { limit, windowMs }) {
  const now = Date.now();
  const cutoff = now - windowMs;
  const arr = REQUESTS.get(key) ?? [];
  // Drop timestamps outside the window
  const recent = arr.filter(t => t > cutoff);

  if (recent.length >= limit) {
    const oldest = recent[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    REQUESTS.set(key, recent);
    return { ok: false, remaining: 0, retryAfterSec };
  }

  recent.push(now);
  REQUESTS.set(key, recent);
  return { ok: true, remaining: limit - recent.length, retryAfterSec: 0 };
}

// ── Account-lockout helpers ────────────────────────────────────────────────────

/** Increment the failure count for a key and return the new count. */
export function recordFailure(key) {
  const now = Date.now();
  const entry = FAILURES.get(key);
  if (!entry || now - entry.lastAt > FAILURE_TTL_MS) {
    FAILURES.set(key, { count: 1, firstAt: now, lastAt: now });
    return 1;
  }
  entry.count += 1;
  entry.lastAt = now;
  return entry.count;
}

/** Current failure count (0 if no entry / decayed). */
export function failureCount(key) {
  const entry = FAILURES.get(key);
  if (!entry) return 0;
  if (Date.now() - entry.lastAt > FAILURE_TTL_MS) {
    FAILURES.delete(key);
    return 0;
  }
  return entry.count;
}

/** Wipe the failure counter (call on successful login). */
export function clearFailures(key) {
  FAILURES.delete(key);
}

/**
 * Compute the IP a request appears to originate from. Honours common reverse-
 * proxy headers but falls back to a literal 'unknown' bucket so we still
 * apply a limit even when headers are absent (would otherwise be a bypass).
 */
export function getClientIp(request) {
  const xf = request.headers.get('x-forwarded-for');
  if (xf) return xf.split(',')[0].trim();
  const xr = request.headers.get('x-real-ip');
  if (xr) return xr.trim();
  return 'unknown';
}

// ── Maintenance ────────────────────────────────────────────────────────────────
// Periodic prune so the in-memory maps don't grow forever on long-running
// servers. Cheap O(n) scan; runs on a 5-minute timer. The handle is unref'd so
// it doesn't keep the Node event loop alive on shutdown.
if (typeof setInterval === 'function') {
  const timer = setInterval(() => {
    const now = Date.now();
    // Aggressive cleanup: any request bucket whose newest entry is older than
    // 1 hour is a stale bucket no live policy is tracking.
    for (const [key, arr] of REQUESTS) {
      const newest = arr[arr.length - 1] ?? 0;
      if (now - newest > 60 * 60 * 1000) REQUESTS.delete(key);
    }
    for (const [key, entry] of FAILURES) {
      if (now - entry.lastAt > FAILURE_TTL_MS) FAILURES.delete(key);
    }
  }, 5 * 60 * 1000);
  if (typeof timer.unref === 'function') timer.unref();
}
