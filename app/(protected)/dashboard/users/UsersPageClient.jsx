'use client';

import { useState, useMemo, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle, CheckCircle2, ChevronDown, Eye, EyeOff,
  KeyRound, Pencil, Plus, Search, Shield, Trash2,
  UserCheck, UserMinus, Users, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody } from '@/components/ui/dialog';
import { createUser, updateUser, toggleUserActive, resetUserPassword, deleteUser } from '@/app/actions/users';

// ── Constants ─────────────────────────────────────────────────────────────────

const ROLES = ['ADMIN', 'NLDC', 'SRLDC', 'NRLDC', 'ERLDC', 'WRLDC', 'NERLDC'];

const ROLE_META = {
  ADMIN:  { label: 'Administrator',      color: 'bg-violet-50 text-violet-700 border-violet-200' },
  NLDC:   { label: 'National LDC',       color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  SRLDC:  { label: 'Southern RLDC',      color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  NRLDC:  { label: 'Northern RLDC',      color: 'bg-blue-50 text-blue-700 border-blue-200' },
  ERLDC:  { label: 'Eastern RLDC',       color: 'bg-orange-50 text-orange-700 border-orange-200' },
  WRLDC:  { label: 'Western RLDC',       color: 'bg-amber-50 text-amber-700 border-amber-200' },
  NERLDC: { label: 'North-Eastern RLDC', color: 'bg-pink-50 text-pink-700 border-pink-200' },
};

const EMPTY_FORM = { name: '', email: '', password: '', role: 'NLDC' };

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name) {
  return name?.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() || 'U';
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RoleBadge({ role }) {
  const m = ROLE_META[role];
  if (!m) return null;
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${m.color}`}>
      {role}
    </span>
  );
}

function UserFormModal({ open, onClose, editing, currentUserId }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState(editing ? { name: editing.name, email: editing.email, role: editing.role, password: '' } : EMPTY_FORM);
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState(null);

  function set(k, v) { setForm((p) => ({ ...p, [k]: v })); }

  function handleClose() { setError(null); onClose(); }

  function onSubmit(e) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = editing
        ? await updateUser(editing.id, { name: form.name, email: form.email, role: form.role })
        : await createUser({ name: form.name, email: form.email, password: form.password, role: form.role });

      if (result?.error) { setError(result.error); return; }
      toast.success(editing ? 'User updated successfully.' : 'User created successfully.');
      router.refresh();
      handleClose();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit User' : 'Create New User'}</DialogTitle>
          <DialogDescription>
            {editing ? "Update the user's name, email address, or role." : 'Add a new portal user with a specific role.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 mb-4 text-xs text-destructive">
              <AlertCircle className="size-3.5 shrink-0" /> {error}
            </div>
          )}
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">Full Name *</label>
              <Input placeholder="e.g. Rajesh Kumar" value={form.name} onChange={(e) => set('name', e.target.value)} required />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">Email Address *</label>
              <Input type="email" placeholder="user@ftc.gov.in" value={form.email} onChange={(e) => set('email', e.target.value)} required />
            </div>
            {!editing && (
              <div>
                <label className="text-sm font-medium text-foreground block mb-1.5">Password *</label>
                <div className="relative">
                  <Input
                    type={showPw ? 'text' : 'password'}
                    placeholder="Min. 8 characters"
                    value={form.password}
                    onChange={(e) => set('password', e.target.value)}
                    required
                  />
                  <button type="button" onClick={() => setShowPw(!showPw)}
                    className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                    {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
            )}
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">Role *</label>
              <div className="relative">
                <select
                  value={form.role}
                  onChange={(e) => set('role', e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm appearance-none pe-8"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{ROLE_META[r]?.label ?? r} ({r})</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">
                RLDC roles restrict data access to the assigned region.
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" onClick={handleClose} className="flex-1">Cancel</Button>
              <Button type="submit" disabled={isPending} className="flex-1">
                {isPending ? (editing ? 'Saving…' : 'Creating…') : (editing ? 'Save Changes' : 'Create User')}
              </Button>
            </div>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordModal({ open, onClose, target }) {
  const [isPending, startTransition] = useTransition();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState(null);

  function handleClose() { setError(null); setPassword(''); setConfirm(''); onClose(); }

  function onSubmit(e) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    startTransition(async () => {
      const result = await resetUserPassword(target.id, password);
      if (result?.error) { setError(result.error); return; }
      toast.success(`Password reset for ${target.name}.`);
      handleClose();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Reset Password</DialogTitle>
          <DialogDescription>Set a new password for <strong>{target?.name}</strong>. All active sessions will be terminated.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 mb-4 text-xs text-destructive">
              <AlertCircle className="size-3.5 shrink-0" /> {error}
            </div>
          )}
          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">New Password *</label>
              <div className="relative">
                <Input type={showPw ? 'text' : 'password'} placeholder="Min. 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} required />
                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">Confirm Password *</label>
              <Input type={showPw ? 'text' : 'password'} placeholder="Repeat new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" onClick={handleClose} className="flex-1">Cancel</Button>
              <Button type="submit" disabled={isPending} className="flex-1">{isPending ? 'Resetting…' : 'Reset Password'}</Button>
            </div>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function DeleteConfirmModal({ open, onClose, target, currentUserId }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteUser(target.id);
      if (result?.error) { toast.error(result.error); return; }
      toast.success(`${target.name} deleted.`);
      router.refresh();
      onClose();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete User</DialogTitle>
          <DialogDescription>
            This will permanently delete <strong>{target?.name}</strong> and cannot be undone.
            Their projects and notes will remain in the system.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button
              type="button"
              onClick={handleDelete}
              disabled={isPending}
              className="flex-1 bg-destructive hover:bg-destructive/90 text-white"
            >
              {isPending ? 'Deleting…' : 'Delete User'}
            </Button>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function UsersPageClient({ users: initialUsers, currentUserId }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const filtered = useMemo(() => {
    let rows = initialUsers;
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    }
    if (roleFilter !== 'All') rows = rows.filter((u) => u.role === roleFilter);
    if (statusFilter === 'Active') rows = rows.filter((u) => u.isActive);
    if (statusFilter === 'Inactive') rows = rows.filter((u) => !u.isActive);
    return rows;
  }, [initialUsers, search, roleFilter, statusFilter]);

  const stats = useMemo(() => ({
    total: initialUsers.length,
    active: initialUsers.filter((u) => u.isActive).length,
    admin: initialUsers.filter((u) => u.role === 'ADMIN').length,
  }), [initialUsers]);

  function handleToggle(user) {
    startTransition(async () => {
      const result = await toggleUserActive(user.id);
      if (result?.error) { toast.error(result.error); return; }
      toast.success(result.nowActive ? `${user.name} activated.` : `${user.name} deactivated.`);
      router.refresh();
    });
  }

  return (
    <div className="px-4 lg:px-6 pb-8 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-lg bg-violet-50 flex items-center justify-center shrink-0">
            <Users className="size-5 text-violet-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">User Management</h1>
            <p className="text-sm text-muted-foreground">{stats.total} users · {stats.active} active</p>
          </div>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4 mr-2" /> Add User
        </Button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total Users',    value: stats.total,                     color: 'text-foreground',     bg: 'bg-muted/30' },
          { label: 'Active',         value: stats.active,                    color: 'text-emerald-600',    bg: 'bg-emerald-50' },
          { label: 'Inactive',       value: stats.total - stats.active,      color: 'text-amber-600',      bg: 'bg-amber-50' },
        ].map((s) => (
          <div key={s.label} className={`rounded-xl border bg-card p-4 ${s.bg}`}>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">{s.label}</p>
            <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full h-9 rounded-md border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {[
          { val: roleFilter, set: setRoleFilter, opts: ['All', ...ROLES], label: 'Role' },
          { val: statusFilter, set: setStatusFilter, opts: ['All', 'Active', 'Inactive'], label: 'Status' },
        ].map((f, i) => (
          <div key={i} className="relative">
            <select
              value={f.val} onChange={(e) => f.set(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm appearance-none pe-7 focus:outline-none focus:ring-2 focus:ring-ring/30 cursor-pointer"
            >
              {f.opts.map((o) => <option key={o}>{o}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          </div>
        ))}

        <span className="ms-auto text-xs text-muted-foreground">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="bg-muted/30 border-b border-border">
              <tr>
                {['User', 'Role', 'Projects', 'Status', 'Joined', 'Actions'].map((h) => (
                  <th key={h} className={`px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide ${h === 'Actions' ? 'text-right' : ''}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                    No users match the current filters.
                  </td>
                </tr>
              ) : (
                filtered.map((user) => (
                  <tr key={user.id} className={`hover:bg-muted/20 transition-colors ${!user.isActive ? 'opacity-60' : ''}`}>
                    {/* User */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`size-8 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold
                          ${user.isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                          {initials(user.name)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{user.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                        </div>
                        {user.id === currentUserId && (
                          <span className="inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary shrink-0">YOU</span>
                        )}
                      </div>
                    </td>
                    {/* Role */}
                    <td className="px-4 py-3"><RoleBadge role={user.role} /></td>
                    {/* Projects */}
                    <td className="px-4 py-3 text-sm text-muted-foreground font-mono">{user._count.createdProjects}</td>
                    {/* Status */}
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold border
                        ${user.isActive
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                        <span className={`size-1.5 rounded-full ${user.isActive ? 'bg-emerald-400' : 'bg-slate-400'}`} />
                        {user.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {/* Joined */}
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(user.createdAt)}</td>
                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setEditTarget(user)}
                          title="Edit user"
                          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          onClick={() => setResetTarget(user)}
                          title="Reset password"
                          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        >
                          <KeyRound className="size-3.5" />
                        </button>
                        {user.id !== currentUserId && (
                          <>
                            <button
                              onClick={() => handleToggle(user)}
                              disabled={isPending}
                              title={user.isActive ? 'Deactivate' : 'Activate'}
                              className={`p-1.5 rounded-md transition-colors disabled:opacity-50
                                ${user.isActive
                                  ? 'text-muted-foreground hover:text-amber-600 hover:bg-amber-50'
                                  : 'text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50'}`}
                            >
                              {user.isActive ? <UserMinus className="size-3.5" /> : <UserCheck className="size-3.5" />}
                            </button>
                            <button
                              onClick={() => setDeleteTarget(user)}
                              title="Delete user"
                              className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-border bg-muted/10">
          <Shield className="size-3.5 text-muted-foreground" />
          <p className="text-[11px] text-muted-foreground">
            User management is restricted to Administrators. RLDC-role accounts can only access data for their assigned region.
          </p>
        </div>
      </div>

      {/* Modals */}
      <UserFormModal open={createOpen} onClose={() => setCreateOpen(false)} editing={null} currentUserId={currentUserId} />
      {editTarget && <UserFormModal open={!!editTarget} onClose={() => setEditTarget(null)} editing={editTarget} currentUserId={currentUserId} />}
      {resetTarget && <ResetPasswordModal open={!!resetTarget} onClose={() => setResetTarget(null)} target={resetTarget} />}
      {deleteTarget && <DeleteConfirmModal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} target={deleteTarget} currentUserId={currentUserId} />}
    </div>
  );
}
