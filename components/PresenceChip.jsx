'use client';

// Admin-only "Viewing now" indicator for the header. Polls /api/presence every
// ~30s and shows a live count of users currently viewing the portal; click to
// see who (name, designation, role). Every logged-in user sends heartbeats, but
// only real admins can read the list — so this renders nothing for other roles.

import { useEffect, useRef, useState } from 'react';
import { Eye } from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';
import { apiFetch } from '@/lib/api-fetch';

const ROLE_BADGE = {
  ADMIN:  'bg-slate-200 text-slate-700',
  NLDC:   'bg-blue-100 text-blue-700',
  SRLDC:  'bg-pink-100 text-pink-700',
  NRLDC:  'bg-indigo-100 text-indigo-700',
  ERLDC:  'bg-cyan-100 text-cyan-700',
  WRLDC:  'bg-orange-100 text-orange-700',
  NERLDC: 'bg-lime-100 text-lime-700',
};

export function PresenceChip() {
  const { user } = useAuth();
  const realAdmin = (user?.realRole ?? user?.role) === 'ADMIN';

  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ count: 0, viewers: [], self: null });
  const boxRef = useRef(null);

  // Poll presence every 30s while the tab is in the foreground (real admins only).
  useEffect(() => {
    if (!realAdmin) return;
    let cancelled = false;
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      apiFetch('/api/presence')
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (j && !cancelled) setData(j); })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 30_000);
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [realAdmin]);

  // Close the dropdown on an outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!user || !realAdmin) return null;

  const { count, viewers, self } = data;

  return (
    <div ref={boxRef} className="relative hidden sm:block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Users currently viewing the portal"
        className="flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 h-8 px-2 text-emerald-800 hover:bg-emerald-100 transition-colors"
      >
        <span className="relative flex size-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-70 animate-ping" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
        </span>
        <span className="text-[11px] font-semibold whitespace-nowrap tabular-nums">
          {count} viewing now
        </span>
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-64 rounded-lg border border-border bg-popover shadow-lg z-[60] overflow-hidden">
          <div className="px-3 py-2 border-b border-border bg-muted/40 flex items-center gap-2">
            <Eye className="size-3.5 text-emerald-600" />
            <span className="text-[11px] font-semibold text-foreground">Viewing now</span>
            <span className="ml-auto text-[10px] text-muted-foreground">{count} online</span>
          </div>
          <div className="max-h-72 overflow-auto py-1">
            {viewers.length === 0 ? (
              <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">No one is viewing right now.</div>
            ) : (
              viewers.map((v) => (
                <div key={v.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent">
                  <span className="size-1.5 rounded-full bg-emerald-500 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium text-foreground truncate">
                      {v.name}
                      {v.id === self && <span className="text-[10px] text-muted-foreground font-normal"> (you)</span>}
                    </div>
                    {v.designation && <div className="text-[10px] text-muted-foreground truncate">{v.designation}</div>}
                  </div>
                  <span className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold ${ROLE_BADGE[v.role] ?? 'bg-slate-100 text-slate-600'}`}>
                    {v.role}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
