// Same-origin API fetch that transparently recovers from a lapsed access token.
//
// The 15-minute access token is refreshed proactively by the AuthProvider, but
// that interval can be throttled while the tab is backgrounded — so a token can
// expire and a subsequent client fetch to a protected /api route returns 401.
// Rather than surfacing that as a spurious "Unauthorized", this helper refreshes
// the session once (POST /api/auth/refresh sets a fresh access_token cookie) and
// retries the original request. Concurrent 401s share a single in-flight refresh.
//
// Use for any client-side fetch to a protected API route.

let refreshing = null;

function refreshOnce() {
  if (!refreshing) {
    refreshing = fetch('/api/auth/refresh', { method: 'POST' })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

export async function apiFetch(input, init) {
  let res = await fetch(input, init);
  if (res.status === 401) {
    const ok = await refreshOnce();
    if (ok) res = await fetch(input, init);
  }
  return res;
}
