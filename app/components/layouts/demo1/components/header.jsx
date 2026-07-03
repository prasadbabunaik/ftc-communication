'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Clock, LogOut, Menu, Settings, User } from 'lucide-react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/providers/auth-provider';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/common/container';
import { NotificationBell } from '@/components/common/NotificationBell';
import { SidebarMenu } from './sidebar-menu';

function useScrollPosition() {
  const [scrollPosition, setScrollPosition] = useState(0);
  useEffect(() => {
    const handleScroll = () => setScrollPosition(window.scrollY);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);
  return scrollPosition;
}

const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

function getPageInfo(pathname) {
  // Dashboard routes
  if (pathname === '/dashboard')                              return { title: 'Dashboard',              sub: 'FTC Communication Portal' };
  if (pathname.startsWith('/dashboard/messages'))            return { title: 'Messages',               sub: 'Communication' };
  if (pathname.startsWith('/dashboard/notifications'))       return { title: 'Notifications',          sub: 'Communication' };
  if (pathname.startsWith('/dashboard/grid-status'))         return { title: 'Grid Status',            sub: 'Grid Operations' };
  if (pathname.startsWith('/dashboard/reports'))             return { title: 'Reports',                sub: 'Grid Operations' };
  if (pathname.startsWith('/dashboard/activity'))            return { title: 'Activity Log',           sub: 'Grid Operations' };
  if (pathname.startsWith('/dashboard/users'))               return { title: 'User Management',        sub: 'Administration' };
  if (pathname.startsWith('/dashboard/access'))              return { title: 'Access Control',         sub: 'Administration' };
  if (pathname.startsWith('/dashboard/settings'))            return { title: 'Settings',               sub: 'Administration' };
  if (pathname.startsWith('/dashboard/profile'))             return { title: 'Profile',                sub: 'Account' };

  // Grid Tracker routes
  if (pathname === '/contd4')                                return { title: 'CONTD-4 Applications',     sub: 'Grid Tracker' };
  if (pathname === '/ftc')                                   return { title: 'FTC Tracker',              sub: 'Grid Tracker' };
  if (pathname === '/hybrid-ftc')                            return { title: 'Hybrid FTC Tracker',       sub: 'Grid Tracker' };
  if (pathname === '/transmission')                          return { title: 'Transmission',             sub: 'Grid Tracker' };
  if (pathname === '/transmission/new')                      return { title: 'Add Transmission Element', sub: 'Grid Tracker' };

  return { title: 'FTC Portal', sub: 'FTC Communication Portal' };
}

function SessionTimer() {
  const { logout, lastActivityRef } = useAuth();
  const [secsLeft, setSecsLeft]     = useState(INACTIVITY_TIMEOUT_MS / 1000);
  const [showWarn, setShowWarn]     = useState(false);

  // Countdown tick — reads the shared lastActivityRef from auth-provider
  useEffect(() => {
    const id = setInterval(() => {
      const remaining = Math.max(0, INACTIVITY_TIMEOUT_MS - (Date.now() - lastActivityRef.current));
      const secs = Math.ceil(remaining / 1000);
      setSecsLeft(secs);
      if (remaining <= 0) logout();
    }, 1000);
    return () => clearInterval(id);
  }, [logout, lastActivityRef]);

  // Show warning dialog at 2 minutes remaining
  useEffect(() => {
    if (secsLeft > 0 && secsLeft <= 120) setShowWarn(true);
    else if (secsLeft > 120)             setShowWarn(false);
  }, [secsLeft]);

  function stayActive() {
    lastActivityRef.current = Date.now();
    setSecsLeft(INACTIVITY_TIMEOUT_MS / 1000);
    setShowWarn(false);
  }

  const mins    = Math.floor(secsLeft / 60);
  const secs    = secsLeft % 60;
  const display = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  const isDanger  = secsLeft <= 120;
  const isWarning = secsLeft <= 300;

  const textColor = isDanger
    ? 'text-red-600'
    : isWarning
      ? 'text-amber-600'
      : 'text-foreground';

  return (
    <>
      <div className="hidden lg:flex flex-col items-end leading-none gap-0.5">
        <span className={`text-xs font-mono font-semibold tabular-nums tracking-tight transition-colors ${textColor} ${isDanger ? 'animate-pulse' : ''}`}>
          {display}
        </span>
        <span className="text-[10px] text-muted-foreground">Session</span>
      </div>

      {/* Warning dialog */}
      {showWarn && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-xl border border-border shadow-2xl p-6 w-[340px] text-center space-y-4">
            <div className="size-12 rounded-full bg-amber-100 border border-amber-200 flex items-center justify-center mx-auto">
              <Clock className="size-6 text-amber-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Session Expiring Soon</p>
              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                You have been inactive. Your session will expire in{' '}
                <span className={`font-mono font-bold ${isDanger ? 'text-red-600' : 'text-amber-600'}`}>
                  {display}
                </span>
                .
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowWarn(false); logout(); }}
                className="flex-1 px-4 py-2 text-sm rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors"
              >
                Log Out
              </button>
              <button
                onClick={stayActive}
                className="flex-1 px-4 py-2 text-sm rounded-md bg-primary text-white hover:bg-primary/90 font-medium transition-colors"
              >
                Stay Logged In
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function FrequencyPill() {
  return (
    <div className="hidden xl:flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/8 border border-emerald-500/20">
      <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
      <span className="text-[11px] font-mono font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
        50.02 Hz
      </span>
      <span className="text-[9px] text-muted-foreground/60 font-medium tracking-wider uppercase">
        Grid
      </span>
    </div>
  );
}

function UserMenu({ user, onLogout }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-full focus:outline-none group"
      >
        {/* Name + role on xl screens */}
        <div className="hidden xl:flex flex-col items-end leading-none gap-0.5 me-0.5">
          <span className="text-xs font-semibold text-foreground">
            {user?.name?.split(' ')[0]}
          </span>
          <span className="text-[10px] text-muted-foreground">{user?.role}</span>
        </div>
        {/* Avatar circle */}
        <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center border-2 border-primary/20 group-hover:border-primary/40 transition-colors shrink-0">
          <span className="text-primary font-bold text-sm leading-none">
            {user?.name?.charAt(0)?.toUpperCase() ?? 'U'}
          </span>
        </div>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute end-0 top-full mt-2 w-56 rounded-xl border border-border bg-background shadow-lg z-50 overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <p className="text-sm font-semibold text-foreground">{user?.name}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
              <span className="inline-flex mt-1.5 items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {user?.role}
              </span>
            </div>
            <div className="py-1">
              <Link
                href="/dashboard/profile"
                className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-accent"
                onClick={() => setOpen(false)}
              >
                <User className="size-4 text-muted-foreground" />
                Profile
              </Link>
              <Link
                href="/dashboard/settings"
                className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-accent"
                onClick={() => setOpen(false)}
              >
                <Settings className="size-4 text-muted-foreground" />
                Settings
              </Link>
            </div>
            <div className="border-t border-border py-1">
              <button
                onClick={() => { setOpen(false); onLogout(); }}
                className="flex w-full items-center gap-2 px-4 py-2 text-sm text-destructive hover:bg-destructive/10"
              >
                <LogOut className="size-4" />
                Sign Out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function Header() {
  const [isSidebarSheetOpen, setIsSidebarSheetOpen] = useState(false);
  const pathname = usePathname();
  const mobileMode = useIsMobile();
  const scrollPosition = useScrollPosition();
  const { user, logout } = useAuth();

  useEffect(() => {
    setIsSidebarSheetOpen(false);
  }, [pathname]);

  const { title: pageTitle, sub: pageSub } = getPageInfo(pathname);

  return (
    <>
      <header
        className={cn(
          // z-40: the fixed header creates a stacking context, so its account
          // dropdown (z-50 inside) is capped at the header's own z-index. It must
          // sit ABOVE the page's sticky tab/filter bar (z-30) or the dropdown
          // bleeds under the "Excl./Incl. Hybrid" toggle. Stays below modals/
          // popovers (z-50) so those still overlay the header.
          'header fixed top-0 z-40 start-0 end-0 flex flex-col shrink-0 bg-background transition-shadow duration-200',
          scrollPosition > 0 ? 'border-b border-border shadow-sm' : 'border-b border-transparent',
        )}
      >
        {/* Top gradient accent line */}
        <div
          className="h-[3px] w-full shrink-0"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, #3b82f6 15%, #06b6d4 50%, #3b82f6 85%, transparent 100%)',
          }}
        />

        {/* Main header row */}
        <Container width="fluid" className="flex flex-1 justify-between items-center lg:gap-4">

          {/* ── Mobile: logo + hamburger ── */}
          <div className="flex items-center gap-2 lg:hidden">
            <Link href="/dashboard" className="shrink-0">
              <Image
                src="/logo-icon.png"
                alt="Grid India"
                width={36}
                height={36}
                className="h-8 w-auto object-contain"
                priority
              />
            </Link>
            {mobileMode && (
              <button
                onClick={() => setIsSidebarSheetOpen(true)}
                className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
              >
                <Menu className="size-5" />
              </button>
            )}
          </div>

          {/* ── Desktop: page title with accent bar ── */}
          <div className="hidden lg:flex items-center gap-3">
            <div className="h-5 w-[3px] rounded-full bg-primary/70" />
            <div className="flex flex-col leading-none gap-0.5">
              <span className="text-sm font-semibold text-foreground">{pageTitle}</span>
              <span className="text-[10px] text-muted-foreground tracking-wide">
                {pageSub}
              </span>
            </div>
          </div>

          {/* ── Center: system frequency pill (xl+) ── */}
          {/* <FrequencyPill /> */}

          {/* ── Right: clock + bell + user ── */}
          <div className="flex items-center gap-2 lg:gap-3">
            {/* Divider before clock (desktop only) */}
            <div className="hidden lg:block h-5 w-px bg-border" />

            {user && <SessionTimer />}

            <NotificationBell />

            {user && <UserMenu user={user} onLogout={logout} />}
          </div>
        </Container>
      </header>

      {/* Mobile sidebar drawer */}
      {mobileMode && isSidebarSheetOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setIsSidebarSheetOpen(false)}
          />
          <div className="fixed top-0 left-0 bottom-0 z-50 w-[275px] bg-background border-e border-border overflow-y-auto">
            <div className="flex items-center px-5 py-4 border-b border-border">
              <Image
                src="/logo-full.png"
                alt="Grid India"
                width={140}
                height={40}
                className="h-8 w-auto object-contain"
              />
            </div>
            <SidebarMenu />
          </div>
        </>
      )}
    </>
  );
}
