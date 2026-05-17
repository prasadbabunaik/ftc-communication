// reCAPTCHA v2 server-side verification.
//
// If RECAPTCHA_SECRET_KEY isn't set, verification is treated as disabled — all
// tokens pass. That lets dev environments without a key still log in. In any
// environment where the key IS set, missing/empty/invalid tokens are rejected.

const VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

export function isRecaptchaEnabled() {
  return Boolean(process.env.RECAPTCHA_SECRET_KEY && process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY);
}

/**
 * Verify a reCAPTCHA token against Google's siteverify endpoint.
 *
 * @param {string} token       The g-recaptcha-response token from the client.
 * @param {string} [remoteIp]  Optional client IP (forwarded for Google's risk model).
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function verifyRecaptcha(token, remoteIp) {
  if (!isRecaptchaEnabled()) {
    return { success: true }; // disabled in this environment
  }
  if (!token || typeof token !== 'string') {
    return { success: false, error: 'Missing reCAPTCHA token' };
  }

  const body = new URLSearchParams({
    secret:   process.env.RECAPTCHA_SECRET_KEY,
    response: token,
  });
  if (remoteIp) body.append('remoteip', remoteIp);

  let json;
  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      // Google's endpoint is usually fast; cap the wait so a slow response
      // doesn't hang the whole login request.
      signal: AbortSignal.timeout(5_000),
    });
    json = await res.json();
  } catch (err) {
    console.error('[recaptcha] verify request failed:', err?.message);
    return { success: false, error: 'reCAPTCHA verification unavailable' };
  }

  if (!json?.success) {
    // `error-codes` is an array per Google's docs; surface them for debugging.
    const codes = Array.isArray(json?.['error-codes']) ? json['error-codes'].join(',') : 'unknown';
    return { success: false, error: `reCAPTCHA rejected (${codes})` };
  }
  return { success: true };
}
