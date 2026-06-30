'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import Image from 'next/image';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const RECAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ?? '';
const RECAPTCHA_ENABLED  = Boolean(RECAPTCHA_SITE_KEY);
const SSO_ENABLED        = process.env.NEXT_PUBLIC_SSO_ENABLED === 'true';

// Friendly messages for the ?sso_error=… returned by the Entra callback.
const SSO_ERRORS = {
  disabled:         'Microsoft sign-in is not configured.',
  denied:           'Microsoft sign-in was cancelled.',
  invalid:          'Microsoft sign-in failed (invalid response). Please try again.',
  state:            'Microsoft sign-in expired. Please try again.',
  token:            'Could not verify your Microsoft sign-in. Please try again.',
  noemail:          'Your Microsoft account did not return an email address.',
  notfound:         'No portal account exists for your Microsoft email. Contact the administrator.',
  disabled_account: 'Your account is deactivated. Contact the administrator.',
};
import { Alert, AlertIcon, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/providers/auth-provider';
import { GovLoader } from '@/components/ui/gov-loader';

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

/* ── Tower illustration (background watermark) ── */
function TowerIllustration() {
  return (
    <svg viewBox="0 0 600 500" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="ti-glow">
          <feGaussianBlur stdDeviation="2.5" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="ti-glow-lg">
          <feGaussianBlur stdDeviation="6" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <style>{`
          @keyframes ti-fl { from{stroke-dashoffset:60}to{stroke-dashoffset:0} }
          @keyframes ti-fr { from{stroke-dashoffset:0}to{stroke-dashoffset:60} }
          @keyframes ti-pulse { 0%,100%{opacity:.45}50%{opacity:1} }
          @keyframes ti-blink { 0%,100%{opacity:1}50%{opacity:.25} }
          .ti-fl  { stroke-dasharray:10 7; animation:ti-fl  2s   linear infinite }
          .ti-fr  { stroke-dasharray:10 7; animation:ti-fr  2.5s linear infinite }
          .ti-fls { stroke-dasharray:14 9; animation:ti-fl  3.5s linear infinite }
          .ti-p   { animation:ti-pulse 2.5s ease-in-out infinite }
          .ti-bl  { animation:ti-blink 2s  ease-in-out infinite }
        `}</style>
      </defs>
      <ellipse cx="300" cy="492" rx="290" ry="48" fill="rgba(59,130,246,0.07)"/>
      {[30,88,145,202,258,315,372,428,484,540,60,118,175,232,290,346,403,460,516,572].map((cx, i) => (
        <circle key={i} cx={cx} cy={14 + (i * 19) % 175} r={i % 5 === 0 ? 1.4 : 0.7}
          fill="rgba(255,255,255,0.22)" className={i % 4 === 0 ? 'ti-p' : ''}
          style={{ animationDelay: `${i * 0.27}s` }}/>
      ))}
      <path className="ti-fl" d="M 95,106 Q 76,122 62,128" fill="none" stroke="rgba(99,179,237,0.78)" strokeWidth="1.9" filter="url(#ti-glow)"/>
      <path d="M 95,111 Q 75,126 62,132" fill="none" stroke="rgba(147,197,253,0.45)" strokeWidth="1.2"/>
      <path className="ti-fr" d="M 505,106 Q 524,122 538,128" fill="none" stroke="rgba(99,179,237,0.78)" strokeWidth="1.9" filter="url(#ti-glow)"/>
      <path d="M 505,111 Q 525,126 538,132" fill="none" stroke="rgba(147,197,253,0.45)" strokeWidth="1.2"/>
      <path className="ti-fl" d="M 125,156 Q 93,167 58,172" fill="none" stroke="rgba(96,165,250,0.65)" strokeWidth="1.6"/>
      <path d="M 125,161 Q 92,171 58,176" fill="none" stroke="rgba(147,197,253,0.35)" strokeWidth="1.1"/>
      <path className="ti-fr" d="M 475,156 Q 507,167 542,172" fill="none" stroke="rgba(96,165,250,0.65)" strokeWidth="1.6"/>
      <path d="M 475,161 Q 508,171 542,176" fill="none" stroke="rgba(147,197,253,0.35)" strokeWidth="1.1"/>
      {/* Left bg tower */}
      <line x1="40" y1="94" x2="34" y2="152" stroke="rgba(255,255,255,0.22)" strokeWidth="0.9"/>
      <line x1="40" y1="94" x2="46" y2="152" stroke="rgba(255,255,255,0.22)" strokeWidth="0.9"/>
      <line x1="18" y1="128" x2="62" y2="128" stroke="rgba(255,255,255,0.36)" strokeWidth="1.5"/>
      <line x1="22" y1="172" x2="58" y2="172" stroke="rgba(255,255,255,0.28)" strokeWidth="1.2"/>
      <line x1="34" y1="152" x2="28" y2="270" stroke="rgba(255,255,255,0.22)" strokeWidth="0.9"/>
      <line x1="46" y1="152" x2="52" y2="270" stroke="rgba(255,255,255,0.22)" strokeWidth="0.9"/>
      <line x1="22" y1="455" x2="28" y2="270" stroke="rgba(255,255,255,0.19)" strokeWidth="0.9"/>
      <line x1="58" y1="455" x2="52" y2="270" stroke="rgba(255,255,255,0.19)" strokeWidth="0.9"/>
      {/* Right bg tower */}
      <line x1="560" y1="94" x2="554" y2="152" stroke="rgba(255,255,255,0.24)" strokeWidth="0.9"/>
      <line x1="560" y1="94" x2="566" y2="152" stroke="rgba(255,255,255,0.24)" strokeWidth="0.9"/>
      <line x1="538" y1="128" x2="582" y2="128" stroke="rgba(255,255,255,0.38)" strokeWidth="1.5"/>
      <line x1="542" y1="172" x2="578" y2="172" stroke="rgba(255,255,255,0.32)" strokeWidth="1.2"/>
      <line x1="554" y1="152" x2="548" y2="270" stroke="rgba(255,255,255,0.24)" strokeWidth="0.9"/>
      <line x1="566" y1="152" x2="572" y2="270" stroke="rgba(255,255,255,0.24)" strokeWidth="0.9"/>
      <line x1="542" y1="455" x2="548" y2="270" stroke="rgba(255,255,255,0.21)" strokeWidth="0.9"/>
      <line x1="578" y1="455" x2="572" y2="270" stroke="rgba(255,255,255,0.21)" strokeWidth="0.9"/>
      {/* Main tower */}
      <polyline points="252,182 237,248 219,322 203,392 185,470" fill="none" stroke="rgba(255,255,255,0.84)" strokeWidth="2.3"/>
      <polyline points="348,182 363,248 381,322 397,392 415,470" fill="none" stroke="rgba(255,255,255,0.84)" strokeWidth="2.3"/>
      <line x1="185" y1="470" x2="415" y2="470" stroke="rgba(255,255,255,0.78)" strokeWidth="2.3"/>
      <line x1="252" y1="182" x2="348" y2="182" stroke="rgba(255,255,255,0.66)" strokeWidth="1.6"/>
      <line x1="237" y1="248" x2="363" y2="248" stroke="rgba(255,255,255,0.56)" strokeWidth="1.4"/>
      <line x1="219" y1="322" x2="381" y2="322" stroke="rgba(255,255,255,0.56)" strokeWidth="1.4"/>
      <line x1="203" y1="392" x2="397" y2="392" stroke="rgba(255,255,255,0.56)" strokeWidth="1.4"/>
      <line x1="252" y1="182" x2="363" y2="248" stroke="rgba(255,255,255,0.43)" strokeWidth="1.3"/>
      <line x1="348" y1="182" x2="237" y2="248" stroke="rgba(255,255,255,0.43)" strokeWidth="1.3"/>
      <line x1="237" y1="248" x2="381" y2="322" stroke="rgba(255,255,255,0.41)" strokeWidth="1.2"/>
      <line x1="363" y1="248" x2="219" y2="322" stroke="rgba(255,255,255,0.41)" strokeWidth="1.2"/>
      <line x1="219" y1="322" x2="397" y2="392" stroke="rgba(255,255,255,0.38)" strokeWidth="1.2"/>
      <line x1="381" y1="322" x2="203" y2="392" stroke="rgba(255,255,255,0.38)" strokeWidth="1.2"/>
      <line x1="260" y1="110" x2="252" y2="182" stroke="rgba(255,255,255,0.74)" strokeWidth="1.9"/>
      <line x1="340" y1="110" x2="348" y2="182" stroke="rgba(255,255,255,0.74)" strokeWidth="1.9"/>
      <line x1="95" y1="106" x2="505" y2="106" stroke="rgba(255,255,255,0.9)" strokeWidth="2.5" filter="url(#ti-glow)"/>
      <line x1="125" y1="156" x2="475" y2="156" stroke="rgba(255,255,255,0.8)" strokeWidth="2.1"/>
      <line x1="292" y1="32" x2="260" y2="110" stroke="rgba(255,255,255,0.8)" strokeWidth="2"/>
      <line x1="308" y1="32" x2="340" y2="110" stroke="rgba(255,255,255,0.8)" strokeWidth="2"/>
      <line x1="300" y1="22" x2="292" y2="32" stroke="rgba(255,255,255,0.88)" strokeWidth="2.2"/>
      <line x1="300" y1="22" x2="308" y2="32" stroke="rgba(255,255,255,0.88)" strokeWidth="2.2"/>
      <circle cx="300" cy="20" r="3.5" fill="rgba(255,255,255,0.96)" filter="url(#ti-glow)"/>
      <polyline points="252,182 237,248 219,322 203,392 185,470" fill="none" stroke="rgba(147,197,253,0.15)" strokeWidth="10" filter="url(#ti-glow-lg)"/>
      <polyline points="348,182 363,248 381,322 397,392 415,470" fill="none" stroke="rgba(147,197,253,0.15)" strokeWidth="10" filter="url(#ti-glow-lg)"/>
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [ssoError, setSsoError] = useState(null);

  // Surface ?sso_error=… returned by the Entra callback (then strip it from the URL).
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('sso_error');
    if (code) {
      setSsoError(SSO_ERRORS[code] ?? 'Microsoft sign-in failed. Please try again.');
      const u = new URL(window.location.href);
      u.searchParams.delete('sso_error');
      window.history.replaceState({}, '', u.toString());
    }
  }, []);

  // reCAPTCHA v2 state. `recaptchaToken` is the g-recaptcha-response value;
  // it's required to submit when the widget is enabled. `widgetIdRef` lets us
  // call grecaptcha.reset() after a failed login so the user can try again.
  const [recaptchaToken, setRecaptchaToken] = useState('');
  const recaptchaContainerRef = useRef(null);
  const widgetIdRef           = useRef(null);

  // Mount the widget. We rely on Google's official `onload` URL-param pattern:
  // when the script loads, Google invokes `window.__onRecaptchaLoad`, which we
  // wire up here. Idempotent — guards against double-render in StrictMode and
  // against being called before the container ref is attached.
  useEffect(() => {
    if (!RECAPTCHA_ENABLED) return;

    const tryRender = () => {
      if (widgetIdRef.current !== null)   return;
      if (!window.grecaptcha?.render)     return;
      if (!recaptchaContainerRef.current) return;
      try {
        widgetIdRef.current = window.grecaptcha.render(recaptchaContainerRef.current, {
          sitekey:    RECAPTCHA_SITE_KEY,
          callback:   (token) => setRecaptchaToken(token),
          'expired-callback': () => setRecaptchaToken(''),
          'error-callback':   () => setRecaptchaToken(''),
        });
      } catch (err) {
        // Most common cause: domain not whitelisted on this site key in the
        // Google reCAPTCHA admin console. Log so the dev sees it in console.
        console.error('[recaptcha] render failed — check site-key domain allowlist:', err);
      }
    };

    // Expose a global callback Google will invoke once api.js finishes loading.
    window.__onRecaptchaLoad = tryRender;
    // If the script was already cached (Strict-Mode remount, fast nav back),
    // grecaptcha may already be ready — try rendering immediately too.
    if (window.grecaptcha?.render) tryRender();

    // Inject Google's api.js at runtime rather than via next/script. A
    // server-rendered <script>/<link rel=preload> for a third-party origin
    // trips ZAP's "Sub-Resource Integrity attribute missing" check, and
    // reCAPTCHA's loader can't carry a stable SRI hash. Injecting it here keeps
    // it out of the SSR HTML entirely while loading exactly the same script.
    const RECAPTCHA_SRC = 'https://www.google.com/recaptcha/api.js?onload=__onRecaptchaLoad&render=explicit';
    if (!document.querySelector(`script[data-recaptcha]`)) {
      const s = document.createElement('script');
      s.src = RECAPTCHA_SRC;
      s.async = true;
      s.defer = true;
      s.setAttribute('data-recaptcha', '');
      document.head.appendChild(s);
    }

    return () => { delete window.__onRecaptchaLoad; };
  }, []);

  const resetRecaptcha = () => {
    setRecaptchaToken('');
    if (widgetIdRef.current !== null && window.grecaptcha?.reset) {
      window.grecaptcha.reset(widgetIdRef.current);
    }
  };

  const form = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values) {
    if (RECAPTCHA_ENABLED && !recaptchaToken) {
      setError('Please complete the reCAPTCHA challenge.');
      return;
    }
    setIsProcessing(true);
    setError(null);
    try {
      await login(values.email, values.password, recaptchaToken);
      router.push('/dashboard');
    } catch (err) {
      setError(err.message || 'An unexpected error occurred. Please try again.');
      // The server has consumed the token; if the user retries we need a new
      // one. Reset the widget so they're forced to re-check.
      resetRecaptcha();
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 lg:p-8"
      style={{ background: '#eef2f7' }}
    >
      {/* Overlay loader while signing in */}
      {isProcessing && (
        <GovLoader
          overlay
          size="page"
          theme="navy"
          label="Verifying credentials"
          sublabel="Please wait. Do not refresh this page."
        />
      )}

      {/* ── Login card ── */}
      <div className="w-full max-w-[900px] flex rounded-2xl overflow-hidden"
        style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.14), 0 0 0 1px rgba(0,0,0,0.07)' }}>

        {/* ══════════════════════════════════════
            Left: Branding panel
            ══════════════════════════════════════ */}
        <div className="hidden lg:flex flex-col w-[400px] shrink-0 relative overflow-hidden"
          style={{ background: '#0B2A5B' }}>

          {/* Saffron top accent */}
          <div className="h-[3px] w-full shrink-0" style={{ background: '#E8821C' }} />

          {/* Tower illustration as watermark */}
          <div className="absolute inset-0 top-[3px] opacity-[0.09] pointer-events-none select-none">
            <TowerIllustration />
          </div>

          {/* Content */}
          <div className="relative z-10 flex flex-col h-full px-10 py-10">

            {/* ── Hero: logo + name ── */}
            <div className="flex flex-col items-center text-center gap-6 mt-4">
              {/* Logo ring */}
              <div className="relative">
                <div className="size-32 rounded-full flex items-center justify-center"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.14)' }}>
                  <Image
                    src="/logo-icon.png"
                    alt="Grid India"
                    width={108}
                    height={108}
                    className="object-contain"
                    priority
                  />
                </div>
                {/* Saffron orbit dot */}
                <span className="absolute top-1 right-1 size-3 rounded-full border-2 border-[#0B2A5B]"
                  style={{ background: '#E8821C' }} />
              </div>

              {/* Organisation name */}
              <div className="space-y-1">
                <h1 className="text-white text-[26px] font-bold tracking-tight leading-none uppercase">
                  GRID-INDIA
                </h1>
                <p className="text-[10px] font-semibold tracking-[0.18em] uppercase"
                  style={{ color: 'rgba(255,255,255,0.45)' }}>
                  Grid Controller Of India Limited
                </p>
              </div>

              {/* Saffron divider */}
              <div className="flex items-center gap-3 w-full px-4">
                <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.1)' }} />
                <div className="flex gap-1">
                  <span className="size-1 rounded-full" style={{ background: '#E8821C' }} />
                  <span className="size-1 rounded-full" style={{ background: 'rgba(232,130,28,0.4)' }} />
                  <span className="size-1 rounded-full" style={{ background: 'rgba(232,130,28,0.15)' }} />
                </div>
                <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.1)' }} />
              </div>

              {/* Portal description */}
              <p className="text-[12px] leading-relaxed text-center max-w-[220px]"
                style={{ color: 'rgba(255,255,255,0.42)' }}>
                First Time Charging Communication for National and Regional Load Dispatch Centres
              </p>
            </div>

            {/* ── Bottom: regions + copyright ── */}
            <div className="mt-auto pt-8">
              <p className="text-center text-[9px] font-semibold tracking-[0.18em] uppercase mb-3"
                style={{ color: 'rgba(255,255,255,0.2)' }}>
                Operational Regions
              </p>
              <div className="flex flex-wrap gap-1.5 justify-center">
                {['NLDC', 'NRLDC', 'SRLDC', 'ERLDC', 'WRLDC', 'NERLDC'].map(r => (
                  <span key={r}
                    className="text-[9px] font-mono font-semibold px-2 py-[3px] rounded"
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      color: 'rgba(255,255,255,0.4)',
                      border: '1px solid rgba(255,255,255,0.09)',
                    }}>
                    {r}
                  </span>
                ))}
              </div>

              <p className="text-center text-[9px] mt-6 tracking-wide"
                style={{ color: 'rgba(255,255,255,0.18)' }}>
                © {new Date().getFullYear()} Grid India · Ministry of Power, Govt. of India
              </p>
            </div>
          </div>
        </div>

        {/* ══════════════════════════════════════
            Right: Login form
            ══════════════════════════════════════ */}
        <div className="flex-1 bg-white flex flex-col justify-center min-w-0">
          <div className="w-full max-w-[360px] mx-auto px-8 py-10">

            {/* Mobile: logo */}
            <div className="lg:hidden flex items-center gap-3 mb-8">
              <Image
                src="/logo-icon.png"
                alt="Grid India"
                width={44}
                height={44}
                className="object-contain"
                priority
              />
              <div>
                <div className="font-bold text-sm text-foreground">Grid India</div>
                <div className="text-[10px] text-muted-foreground">FTC Communication Portal</div>
              </div>
            </div>

            {/* Heading */}
            <div className="mb-7">
              <h2 className="text-2xl font-bold text-foreground tracking-tight">Sign in</h2>
              <p className="text-muted-foreground text-sm mt-1.5">
                Access the FTC Communication Portal
              </p>
            </div>

            {/* Error */}
            {error && (
              <Alert variant="destructive" className="mb-5">
                <AlertIcon><AlertCircle /></AlertIcon>
                <AlertTitle>{error}</AlertTitle>
              </Alert>
            )}

            {/* Form */}
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email address</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="you@grid-india.in"
                          autoComplete="email"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            type={passwordVisible ? 'text' : 'password'}
                            placeholder="Enter your password"
                            autoComplete="current-password"
                            {...field}
                          />
                          <button
                            type="button"
                            onClick={() => setPasswordVisible(!passwordVisible)}
                            className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {passwordVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* reCAPTCHA v2 — only rendered when the site key is set in
                    env. The widget itself is mounted by the useEffect above
                    once Google's api.js fires window.__onRecaptchaLoad. */}
                {RECAPTCHA_ENABLED ? (
                  <div ref={recaptchaContainerRef} className="flex justify-center pt-1" />
                ) : (
                  // Visible diagnostic so it's obvious when the env var didn't
                  // make it into the client bundle (almost always: dev server
                  // wasn't restarted after editing .env).
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                    reCAPTCHA disabled — set <code className="font-mono">NEXT_PUBLIC_RECAPTCHA_SITE_KEY</code> in <code className="font-mono">.env</code> and restart the dev server.
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full mt-2"
                  size="lg"
                  disabled={isProcessing || (RECAPTCHA_ENABLED && !recaptchaToken)}
                >
                  {isProcessing && <GovLoader size="button" />}
                  {isProcessing ? 'Signing in...' : 'Sign in'}
                </Button>
              </form>
            </Form>

            {/* ── Microsoft Entra SSO ── */}
            {SSO_ENABLED && (
              <div className="mt-5">
                <div className="flex items-center gap-3 mb-4">
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">or</span>
                  <span className="h-px flex-1 bg-border" />
                </div>
                {ssoError && (
                  <div className="mb-3 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
                    <AlertCircle className="size-4 shrink-0 mt-0.5" />
                    <span>{ssoError}</span>
                  </div>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="w-full gap-2"
                  onClick={() => { window.location.href = '/api/auth/sso/login'; }}
                >
                  <svg viewBox="0 0 23 23" className="size-4" aria-hidden="true">
                    <rect x="1"  y="1"  width="10" height="10" fill="#f25022" />
                    <rect x="12" y="1"  width="10" height="10" fill="#7fba00" />
                    <rect x="1"  y="12" width="10" height="10" fill="#00a4ef" />
                    <rect x="12" y="12" width="10" height="10" fill="#ffb900" />
                  </svg>
                  Sign in with Microsoft
                </Button>
                <p className="mt-2.5 text-center text-[11px] leading-relaxed text-muted-foreground">
                   Use your
                  {' '}<span className="font-medium text-foreground">GRID-India AD</span> credentials to login.
                </p>
              </div>
            )}

            {/* reCAPTCHA api.js is injected at runtime in the effect above — see
                the SRI note there. */}

            <p className="text-center text-xs text-muted-foreground mt-8">
              © {new Date().getFullYear()} Grid India · FTC Communication Portal
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
