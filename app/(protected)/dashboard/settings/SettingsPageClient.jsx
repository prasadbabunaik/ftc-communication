'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle, Calendar, CheckCircle2, Eye, EyeOff,
  KeyRound, Moon, Settings, Sun, User,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MonthPicker } from '@/components/ui/month-picker';
import { useSettings } from '@/providers/settings-provider';
import { updateProfile, changePassword } from '@/app/actions/profile';

// ── Constants ─────────────────────────────────────────────────────────────────

const ROLE_META = {
  ADMIN:  { label: 'Administrator',      color: 'bg-violet-50 text-violet-700 border-violet-200' },
  NLDC:   { label: 'National LDC',       color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  SRLDC:  { label: 'Southern RLDC',      color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  NRLDC:  { label: 'Northern RLDC',      color: 'bg-blue-50 text-blue-700 border-blue-200' },
  ERLDC:  { label: 'Eastern RLDC',       color: 'bg-orange-50 text-orange-700 border-orange-200' },
  WRLDC:  { label: 'Western RLDC',       color: 'bg-amber-50 text-amber-700 border-amber-200' },
  NERLDC: { label: 'North-Eastern RLDC', color: 'bg-pink-50 text-pink-700 border-pink-200' },
};

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ icon: Icon, title, description, children }) {
  return (
    <div className="rounded-xl border bg-card overflow-hidden shadow-xs">
      <div className="flex items-start gap-3 px-5 py-4 border-b bg-muted/20">
        <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
          <Icon className="size-4 text-primary" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
        </div>
      </div>
      <div className="px-5 py-5">{children}</div>
    </div>
  );
}

function InlineAlert({ type, message }) {
  const styles = {
    error:   'bg-destructive/10 border-destructive/20 text-destructive',
    success: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  };
  const Icon = type === 'error' ? AlertCircle : CheckCircle2;
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${styles[type]}`}>
      <Icon className="size-3.5 shrink-0" /> {message}
    </div>
  );
}

// ── Profile section ───────────────────────────────────────────────────────────

function ProfileSection({ profile }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(profile.name);
  const [feedback, setFeedback] = useState(null);

  function onSubmit(e) {
    e.preventDefault();
    setFeedback(null);
    startTransition(async () => {
      const result = await updateProfile({ name });
      if (result?.error) { setFeedback({ type: 'error', message: result.error }); return; }
      setFeedback({ type: 'success', message: 'Profile updated successfully.' });
      router.refresh();
    });
  }

  const roleMeta = ROLE_META[profile.role];
  const initials = profile.name?.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() || 'U';

  return (
    <Section icon={User} title="Profile" description="Update your display name.">
      <div className="flex items-center gap-4 mb-5">
        <div className="size-14 rounded-full bg-primary/10 border-2 border-primary/20 flex items-center justify-center shrink-0">
          <span className="text-primary font-bold text-lg leading-none">{initials}</span>
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">{profile.name}</p>
          <p className="text-xs text-muted-foreground">{profile.email}</p>
          {roleMeta && (
            <span className={`inline-flex items-center rounded-md border mt-1.5 px-2 py-0.5 text-[11px] font-semibold ${roleMeta.color}`}>
              {roleMeta.label}
            </span>
          )}
        </div>
      </div>

      {feedback && <InlineAlert type={feedback.type} message={feedback.message} />}

      <form onSubmit={onSubmit} className="mt-4 space-y-4 max-w-sm">
        <div>
          <label className="text-sm font-medium text-foreground block mb-1.5">Full Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required />
        </div>
        <div>
          <label className="text-sm font-medium text-foreground block mb-1.5">Email Address</label>
          <Input value={profile.email} disabled className="opacity-60" />
          <p className="text-[11px] text-muted-foreground mt-1">Email cannot be changed here. Contact an administrator.</p>
        </div>
        <Button type="submit" disabled={isPending || name === profile.name} size="sm">
          {isPending ? 'Saving…' : 'Save Profile'}
        </Button>
      </form>

      {/* Account metadata */}
      <div className="mt-5 pt-5 border-t grid grid-cols-3 gap-4">
        {[
          { label: 'Account Created', value: fmtDate(profile.createdAt) },
          { label: 'Projects Created', value: profile._count.createdProjects },
          { label: 'Notes Posted', value: profile._count.projectNotes },
        ].map((s) => (
          <div key={s.label}>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">{s.label}</p>
            <p className="text-sm font-semibold text-foreground">{s.value}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── Password section ──────────────────────────────────────────────────────────

function PasswordSection() {
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [showPw, setShowPw] = useState(false);
  const [feedback, setFeedback] = useState(null);

  function set(k, v) { setForm((p) => ({ ...p, [k]: v })); }

  function onSubmit(e) {
    e.preventDefault();
    setFeedback(null);
    startTransition(async () => {
      const result = await changePassword(form);
      if (result?.error) { setFeedback({ type: 'error', message: result.error }); return; }
      setFeedback({ type: 'success', message: 'Password changed. You may need to log in again on other devices.' });
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    });
  }

  const pwType = showPw ? 'text' : 'password';

  return (
    <Section icon={KeyRound} title="Change Password" description="Use a strong password of at least 8 characters.">
      {feedback && <div className="mb-4"><InlineAlert type={feedback.type} message={feedback.message} /></div>}
      <form onSubmit={onSubmit} className="space-y-4 max-w-sm">
        <div>
          <label className="text-sm font-medium text-foreground block mb-1.5">Current Password *</label>
          <div className="relative">
            <Input type={pwType} value={form.currentPassword} onChange={(e) => set('currentPassword', e.target.value)} required placeholder="Enter current password" />
            <button type="button" onClick={() => setShowPw(!showPw)} className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
              {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
        <div>
          <label className="text-sm font-medium text-foreground block mb-1.5">New Password *</label>
          <Input type={pwType} value={form.newPassword} onChange={(e) => set('newPassword', e.target.value)} required placeholder="Min. 8 characters" />
        </div>
        <div>
          <label className="text-sm font-medium text-foreground block mb-1.5">Confirm New Password *</label>
          <Input type={pwType} value={form.confirmPassword} onChange={(e) => set('confirmPassword', e.target.value)} required placeholder="Repeat new password" />
          {form.newPassword && form.confirmPassword && form.newPassword !== form.confirmPassword && (
            <p className="text-[11px] text-destructive mt-1">Passwords do not match.</p>
          )}
        </div>
        <Button type="submit" disabled={isPending || !form.currentPassword || !form.newPassword || !form.confirmPassword} size="sm">
          {isPending ? 'Changing…' : 'Change Password'}
        </Button>
      </form>
    </Section>
  );
}

// ── Appearance section ────────────────────────────────────────────────────────

function AppearanceSection() {
  const { settings, storeOption } = useSettings();
  const sidebarTheme = settings.layouts.demo1.sidebarTheme;
  const sidebarCollapse = settings.layouts.demo1.sidebarCollapse;

  return (
    <Section icon={Sun} title="Appearance" description="Customise how the portal looks for you.">
      <div className="space-y-5 max-w-sm">
        {/* Sidebar theme */}
        <div>
          <p className="text-sm font-medium text-foreground mb-3">Sidebar Style</p>
          <div className="flex gap-3">
            {[
              { value: 'light', label: 'Light', icon: Sun },
              { value: 'dark',  label: 'Dark',  icon: Moon },
            ].map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => storeOption('layouts.demo1.sidebarTheme', value)}
                className={`flex-1 flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all
                  ${sidebarTheme === value
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border hover:border-muted-foreground/40 text-muted-foreground'}`}
              >
                <Icon className="size-5" />
                <span className="text-xs font-semibold">{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Sidebar collapse */}
        <div className="flex items-center justify-between py-3 border-t border-border">
          <div>
            <p className="text-sm font-medium text-foreground">Collapse Sidebar</p>
            <p className="text-xs text-muted-foreground mt-0.5">Show only icons, expanding on hover</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={sidebarCollapse}
            onClick={() => storeOption('layouts.demo1.sidebarCollapse', !sidebarCollapse)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors
              ${sidebarCollapse ? 'bg-primary' : 'bg-muted-foreground/25'}`}
          >
            <span className={`pointer-events-none inline-block size-5 rounded-full bg-white shadow-md transition-transform
              ${sidebarCollapse ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
      </div>
    </Section>
  );
}

// ── Reference Month section ───────────────────────────────────────────────────

function fmtRefMonthPreview(ym) {
  if (!ym) return '';
  try {
    const d = new Date(`${ym}-01`);
    const month = d.toLocaleString('en-US', { month: 'short' });
    const year  = String(d.getFullYear()).slice(2);
    return `Exp. ${month}'${year}`;
  } catch { return ''; }
}

function ReferenceMonthSection() {
  const { settings, storeOption } = useSettings();
  const value = settings.referenceMonth ?? '2026-04';

  return (
    <Section
      icon={Calendar}
      title="Reference Month"
      description="The rolling target month shown in FTC Tracker and Summary tables (e.g. the 'Expected Apr\'26' column)."
    >
      <div className="max-w-sm space-y-3">
        <div>
          <label className="text-sm font-medium text-foreground block mb-1.5">Current Reference Month</label>
          <MonthPicker
            value={value}
            onChange={(v) => storeOption('referenceMonth', v || '2026-04')}
          />
          <p className="text-[11px] text-muted-foreground mt-1.5">
            Column will show as: <span className="font-semibold text-foreground">{fmtRefMonthPreview(value)}</span>
          </p>
        </div>
      </div>
    </Section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function SettingsPageClient({ profile }) {
  return (
    <div className="px-4 lg:px-6 pb-8 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="size-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
          <Settings className="size-5 text-slate-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground">Manage your account and portal preferences</p>
        </div>
      </div>

      <ProfileSection profile={profile} />
      <PasswordSection />
      <AppearanceSection />
      <ReferenceMonthSection />
    </div>
  );
}
