import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { signAccessToken, signRefreshToken, setAuthCookies } from '@/lib/auth';
import { verifyRecaptcha, isRecaptchaEnabled } from '@/lib/recaptcha';
import {
  rateLimit, recordFailure, failureCount, clearFailures, getClientIp,
} from '@/lib/rate-limit';
import bcrypt from 'bcryptjs';

// Tunables. All durations in ms.
const IP_THROTTLE      = { limit: 20, windowMs: 10 * 60 * 1000 };  // 20 attempts / 10 min per IP
const EMAIL_THROTTLE   = { limit: 10, windowMs: 10 * 60 * 1000 };  // 10 attempts / 10 min per email
const LOCKOUT_THRESHOLD = 5;                                       // after 5 wrong passwords
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;                         // lock 15 min

// 429 helper — also surfaces Retry-After so clients can back off properly.
function tooMany(message, retryAfterSec) {
  const res = NextResponse.json({ message }, { status: 429 });
  if (retryAfterSec) res.headers.set('Retry-After', String(retryAfterSec));
  return res;
}

export async function POST(request) {
  try {
    const ip = getClientIp(request);

    // 1. Per-IP throttle (protects against credential-stuffing across many emails)
    const ipGate = rateLimit(`login:ip:${ip}`, IP_THROTTLE);
    if (!ipGate.ok) {
      return tooMany('Too many login attempts from this IP. Try again later.', ipGate.retryAfterSec);
    }

    const body = await request.json();
    const { email, password, recaptchaToken } = body;

    if (!email || !password) {
      return NextResponse.json(
        { message: 'Email and password are required' },
        { status: 400 },
      );
    }

    const normEmail = String(email).trim().toLowerCase();

    // 2. Per-email throttle (protects a single account from being battered
    //    even when the attacker rotates IPs — limit is wider than the
    //    IP throttle because legitimate users may also have multiple devices).
    const emailGate = rateLimit(`login:email:${normEmail}`, EMAIL_THROTTLE);
    if (!emailGate.ok) {
      return tooMany('Too many attempts for this account. Try again later.', emailGate.retryAfterSec);
    }

    // 3. Account lockout — once the failure counter passes the threshold,
    //    refuse logins for LOCKOUT_DURATION_MS even with the correct password.
    //    Resets on successful login below.
    const fails = failureCount(`login:fail:${normEmail}`);
    if (fails >= LOCKOUT_THRESHOLD) {
      return tooMany(
        'Account temporarily locked due to repeated failed attempts. Try again later.',
        Math.ceil(LOCKOUT_DURATION_MS / 1000),
      );
    }

    // 4. reCAPTCHA — verify token BEFORE the DB lookup so bot traffic doesn't
    //    even cost us a user query. Skipped when not configured.
    if (isRecaptchaEnabled()) {
      const captcha = await verifyRecaptcha(recaptchaToken, ip);
      if (!captcha.success) {
        return NextResponse.json(
          { message: 'reCAPTCHA verification failed. Please try again.' },
          { status: 400 },
        );
      }
    }

    const user = await prisma.user.findUnique({ where: { email: normEmail } });

    if (!user || !user.isActive) {
      // Count this as a failure too — otherwise an attacker who knows an
      // address doesn't exist could probe forever without ever tripping
      // the per-email lockout. (Per-IP and per-email throttles still apply.)
      recordFailure(`login:fail:${normEmail}`);
      return NextResponse.json(
        { message: 'Invalid email or password' },
        { status: 401 },
      );
    }

    const passwordValid = await bcrypt.compare(password, user.password);
    if (!passwordValid) {
      const next = recordFailure(`login:fail:${normEmail}`);
      const remaining = Math.max(0, LOCKOUT_THRESHOLD - next);
      return NextResponse.json(
        {
          message: remaining > 0
            ? `Invalid email or password. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining before lockout.`
            : 'Invalid email or password. Account is now locked.',
        },
        { status: 401 },
      );
    }

    // Successful login → reset the failure counter for this account.
    clearFailures(`login:fail:${normEmail}`);

    const payload = { sub: user.id, email: user.email, role: user.role, name: user.name };

    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken(payload),
      signRefreshToken(payload),
    ]);

    // Store refresh token in DB
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const response = NextResponse.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      accessToken,
    });

    setAuthCookies(response, accessToken, refreshToken);

    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
