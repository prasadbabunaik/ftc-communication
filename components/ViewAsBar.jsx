'use client';

// Admin "View as role" — a compact control in the header's right cluster (so it
// is always visible under the fixed header). Real admins get a role picker;
// while impersonating it turns amber and shows the active role + a quick
// "return to admin". Switching sets the overlay cookie, re-fetches the user and
// refreshes server components so region scope, permissions and menus all follow
// the chosen role.

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Eye } from 'lucide-react';
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

  return (
    <div
      title="Preview the portal as another role (admin only)"
      className={`hidden sm:flex items-center gap-1.5 rounded-md border pl-2 pr-1 h-8 ${
        impersonating ? 'border-amber-300 bg-amber-100 text-amber-900' : 'border-border bg-background text-muted-foreground'
      }`}
    >
      <Eye className={`size-3.5 shrink-0 ${impersonating ? 'text-amber-700' : 'text-slate-400'}`} />
      <span className="text-[11px] font-medium whitespace-nowrap">
        {impersonating ? 'Viewing as' : 'View as'}
      </span>
      <select
        value={impersonating ? user.role : 'ADMIN'}
        onChange={(e) => change(e.target.value)}
        disabled={pending}
        className={`h-6 rounded border bg-transparent px-1 text-[11px] font-semibold focus:outline-none focus:ring-2 focus:ring-ring/30 ${
          impersonating ? 'border-amber-300 text-amber-900' : 'border-input text-foreground'
        }`}
      >
        <option value="ADMIN">Admin (you)</option>
        {VIEW_AS_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
    </div>
  );
}
