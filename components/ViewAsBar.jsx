'use client';

// Admin "View as role" bar. Real admins get a compact role picker; while
// impersonating it becomes a prominent amber banner with a "Return to Admin"
// button so the temporary role is never forgotten. Switching sets the overlay
// cookie, re-fetches the user and refreshes server components so region scope,
// permissions and menus all reflect the chosen role.

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, ShieldCheck, RotateCcw } from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';
import { setViewAsRole } from '@/app/actions/view-as';

const VIEW_AS_ROLES = ['NLDC', 'SRLDC', 'NRLDC', 'ERLDC', 'WRLDC', 'NERLDC'];

export function ViewAsBar() {
  const { user, fetchUser } = useAuth();
  const router = useRouter();
  const [pending, start] = useTransition();

  // Only real admins ever see this. When impersonating, realRole stays 'ADMIN'.
  const realAdmin = (user?.realRole ?? user?.role) === 'ADMIN';
  if (!user || !realAdmin) return null;

  const impersonating = !!user.impersonating;

  const change = (role) => start(async () => {
    await setViewAsRole(role);
    await fetchUser();
    router.refresh();
  });

  const selectEl = (
    <select
      value={impersonating ? user.role : 'ADMIN'}
      onChange={(e) => change(e.target.value)}
      disabled={pending}
      className={`h-7 rounded-md border px-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-ring/30 ${
        impersonating
          ? 'border-amber-300 bg-white text-amber-800'
          : 'border-input bg-background text-foreground'
      }`}
    >
      <option value="ADMIN">Admin (you)</option>
      {VIEW_AS_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
    </select>
  );

  if (impersonating) {
    return (
      <div className="flex items-center justify-center gap-3 bg-amber-100 border-b border-amber-300 px-4 py-1.5 text-xs text-amber-900">
        <Eye className="size-3.5 shrink-0" />
        <span>
          Viewing as <span className="font-bold">{user.role}</span> — this is a temporary preview of that role. You are signed in as Admin.
        </span>
        {selectEl}
        <button
          type="button"
          onClick={() => change('ADMIN')}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md bg-amber-800 text-white px-2 py-1 text-xs font-semibold hover:bg-amber-900 disabled:opacity-50 transition-colors"
        >
          <RotateCcw className="size-3" /> Return to Admin
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-2 bg-slate-50 border-b border-border px-4 py-1 text-[11px] text-muted-foreground">
      <ShieldCheck className="size-3.5 text-slate-400" />
      <span className="font-medium">View portal as:</span>
      {selectEl}
    </div>
  );
}
