'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Bell, Check, CheckCheck, ExternalLink, Trash2,
  Zap, Activity, Cable, FileText, Layers, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

// Poll the API at this interval. Set NEXT_PUBLIC_NOTIFICATIONS_DISABLED=1 in
// .env.local to disable polling entirely (useful during local testing when
// you don't want the bell hammering the API). Tab visibility is respected —
// we pause polling when the tab is hidden to avoid waking the laptop
// pointlessly. We also stop polling permanently on the first 401 so an
// expired session doesn't keep firing requests in the background.
const POLL_MS = 60_000;
const POLLING_DISABLED = process.env.NEXT_PUBLIC_NOTIFICATIONS_DISABLED === '1';

const TYPE_ICON = {
  PROJECT_CREATED:         Zap,
  PROJECT_UPDATED:         FileText,
  CONTD4_STATUS_CHANGED:   Layers,
  PHASE_ADDED:             Layers,
  FTC_EVENT:               Activity,
  TOC_EVENT:               Activity,
  COD_EVENT:               Activity,
  TRANSMISSION_UPDATED:    Cable,
  SNAPSHOT_DIFF:           Activity,
  SYSTEM:                  AlertTriangle,
};

const SEVERITY_COLOR = {
  INFO:     'text-blue-600 bg-blue-50',
  SUCCESS:  'text-emerald-600 bg-emerald-50',
  WARNING:  'text-amber-600 bg-amber-50',
  CRITICAL: 'text-rose-600 bg-rose-50',
};

function fmtRelative(iso) {
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60)    return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60)    return `${min}m ago`;
  const hr  = Math.floor(min / 60);
  if (hr  < 24)    return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7)     return `${day}d ago`;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen]               = useState(false);
  const [items, setItems]             = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading]         = useState(false);
  const popoverRef                    = useRef(null);
  const lastFetchRef                  = useRef(0);
  const stoppedRef                    = useRef(false);

  const fetchItems = useCallback(async (opts = {}) => {
    // Once we've hit a 401 (session expired) or an explicit stop signal,
    // do nothing — polling would otherwise spam the access log with 401s.
    if (stoppedRef.current) return;
    // Skip if we just fetched (debounce against double-clicks)
    if (!opts.force && Date.now() - lastFetchRef.current < 1_000) return;
    lastFetchRef.current = Date.now();
    setLoading(true);
    try {
      const res = await fetch('/api/notifications?limit=30', { cache: 'no-store' });
      if (res.status === 401) {
        // Session is gone — stop polling so we don't keep hitting the API.
        stoppedRef.current = true;
        return;
      }
      if (!res.ok) return;
      const json = await res.json();
      setItems(json.data ?? []);
      setUnreadCount(json.unreadCount ?? 0);
    } catch {
      // Silent — bell can fail without breaking the page
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + polling. Pause when tab is hidden. Skipped entirely when
  // the env-var kill-switch is set.
  useEffect(() => {
    if (POLLING_DISABLED) return;
    fetchItems({ force: true });
    let timer;
    const tick = () => {
      if (stoppedRef.current) return;
      if (document.visibilityState === 'visible') fetchItems();
      timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);

    const onVisibility = () => {
      if (stoppedRef.current) return;
      if (document.visibilityState === 'visible') fetchItems();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchItems]);

  // Close on outside-click
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const markRead = useCallback(async (id) => {
    // Optimistic
    setItems((prev) => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    setUnreadCount((c) => Math.max(0, c - 1));
    await fetch(`/api/notifications/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isRead: true }),
    }).catch(() => fetchItems({ force: true })); // rollback by refetch on failure
  }, [fetchItems]);

  const markAllRead = useCallback(async () => {
    if (unreadCount === 0) return;
    setItems((prev) => prev.map(n => ({ ...n, isRead: true })));
    setUnreadCount(0);
    await fetch('/api/notifications/read-all', { method: 'POST' })
      .catch(() => fetchItems({ force: true }));
  }, [unreadCount, fetchItems]);

  const remove = useCallback(async (id) => {
    setItems((prev) => prev.filter(n => n.id !== id));
    await fetch(`/api/notifications/${id}`, { method: 'DELETE' })
      .catch(() => fetchItems({ force: true }));
  }, [fetchItems]);

  const handleItemClick = useCallback((n) => {
    if (!n.isRead) markRead(n.id);
    if (n.link) {
      setOpen(false);
      router.push(n.link);
    }
  }, [markRead, router]);

  const badge = useMemo(() => {
    if (unreadCount <= 0)  return null;
    if (unreadCount > 99)  return '99+';
    return String(unreadCount);
  }, [unreadCount]);

  return (
    <div className="relative" ref={popoverRef}>
      <Button
        variant="ghost"
        mode="icon"
        shape="circle"
        className="size-9"
        onClick={() => setOpen(o => !o)}
        aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ''}`}
      >
        <Bell className="size-4!" />
      </Button>
      {badge && (
        <span className="absolute top-0.5 end-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 flex items-center justify-center text-[9px] font-bold text-white leading-none pointer-events-none">
          {badge}
        </span>
      )}

      {open && (
        <div className="absolute end-0 top-full mt-2 w-[380px] max-h-[min(80vh,520px)] rounded-xl border border-border bg-background shadow-xl z-50 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-slate-50/60">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">Notifications</span>
              {unreadCount > 0 && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700">
                  {unreadCount} new
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={markAllRead}
              disabled={unreadCount === 0}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-800 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors"
            >
              <CheckCheck className="size-3" /> Mark all read
            </button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {loading && items.length === 0 && (
              <div className="px-4 py-12 text-center text-sm text-muted-foreground">Loading…</div>
            )}

            {!loading && items.length === 0 && (
              <div className="px-4 py-12 text-center">
                <Bell className="size-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">You're all caught up</p>
              </div>
            )}

            {items.map((n) => {
              const Icon = TYPE_ICON[n.type] ?? Bell;
              const iconCls = SEVERITY_COLOR[n.severity] ?? SEVERITY_COLOR.INFO;
              return (
                <div
                  key={n.id}
                  className={`group relative flex gap-3 px-3 py-2.5 border-b border-border last:border-b-0 hover:bg-slate-50 transition-colors cursor-pointer ${
                    n.isRead ? 'opacity-70' : 'bg-blue-50/30'
                  }`}
                  onClick={() => handleItemClick(n)}
                >
                  <div className={`size-8 rounded-full flex items-center justify-center shrink-0 ${iconCls}`}>
                    <Icon className="size-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2">
                      <p className={`text-[13px] leading-tight flex-1 ${n.isRead ? 'text-slate-700' : 'font-semibold text-foreground'}`}>
                        {n.title}
                      </p>
                      {!n.isRead && (
                        <span className="size-2 rounded-full bg-blue-500 shrink-0 mt-1.5" />
                      )}
                    </div>
                    {n.body && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-slate-400">{fmtRelative(n.createdAt)}</span>
                      {n.link && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-blue-600">
                          <ExternalLink className="size-2.5" /> Open
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Per-item actions — visible on hover */}
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-1">
                    {!n.isRead && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); markRead(n.id); }}
                        title="Mark as read"
                        className="size-6 rounded hover:bg-slate-200 flex items-center justify-center text-slate-500 hover:text-slate-700"
                      >
                        <Check className="size-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); remove(n.id); }}
                      title="Delete"
                      className="size-6 rounded hover:bg-rose-100 flex items-center justify-center text-slate-500 hover:text-rose-600"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="px-3 py-2 border-t border-border bg-slate-50/60 text-center">
            <Link
              href="/dashboard/notifications"
              onClick={() => setOpen(false)}
              className="text-[11px] font-medium text-blue-600 hover:text-blue-800"
            >
              View all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
