'use client';

import React from 'react';
import { Shield, CheckCircle2, XCircle, AlertCircle, Info } from 'lucide-react';

// ── Data ──────────────────────────────────────────────────────────────────────

const ROLES = ['ADMIN', 'NLDC', 'SRLDC', 'NRLDC', 'ERLDC', 'WRLDC', 'NERLDC'];

const ROLE_META = {
  ADMIN:  { label: 'Administrator',      region: 'All Regions',        color: 'bg-violet-50 text-violet-700 border-violet-200', dot: 'bg-violet-400' },
  NLDC:   { label: 'National LDC',       region: 'All Regions',        color: 'bg-indigo-50 text-indigo-700 border-indigo-200', dot: 'bg-indigo-400' },
  SRLDC:  { label: 'Southern RLDC',      region: 'SR Region only',     color: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-400' },
  NRLDC:  { label: 'Northern RLDC',      region: 'NR Region only',     color: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-400' },
  ERLDC:  { label: 'Eastern RLDC',       region: 'ER Region only',     color: 'bg-orange-50 text-orange-700 border-orange-200', dot: 'bg-orange-400' },
  WRLDC:  { label: 'Western RLDC',       region: 'WR Region only',     color: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-400' },
  NERLDC: { label: 'North-Eastern RLDC', region: 'NER Region only',    color: 'bg-pink-50 text-pink-700 border-pink-200', dot: 'bg-pink-400' },
};

// Permission matrix: true = full, 'read' = read-only, false = no access
const PERMISSIONS = [
  {
    section: 'Dashboard',
    items: [
      { label: 'View Dashboard',        ADMIN: true,   NLDC: true,   SRLDC: true,   NRLDC: true,   ERLDC: true,   WRLDC: true,   NERLDC: true  },
      { label: 'Grid Summary Widget',   ADMIN: true,   NLDC: true,   SRLDC: true,   NRLDC: true,   ERLDC: true,   WRLDC: true,   NERLDC: true  },
    ],
  },
  {
    section: 'CONTD-4 Applications',
    items: [
      { label: 'View Applications',     ADMIN: true,   NLDC: true,   SRLDC: true,   NRLDC: true,   ERLDC: true,   WRLDC: true,   NERLDC: true  },
      { label: 'Create Application',    ADMIN: true,   NLDC: true,   SRLDC: true,   NRLDC: true,   ERLDC: true,   WRLDC: true,   NERLDC: true  },
      { label: 'Edit Application',      ADMIN: true,   NLDC: true,   SRLDC: true,   NRLDC: true,   ERLDC: true,   WRLDC: true,   NERLDC: true  },
      { label: 'Mark as Cleared',       ADMIN: true,   NLDC: true,   SRLDC: true,   NRLDC: true,   ERLDC: true,   WRLDC: true,   NERLDC: true  },
      { label: 'Delete Application',    ADMIN: true,   NLDC: true,   SRLDC: false,  NRLDC: false,  ERLDC: false,  WRLDC: false,  NERLDC: false },
    ],
  },
  {
    section: 'Generation Projects',
    items: [
      { label: 'View All Projects',     ADMIN: true,   NLDC: true,   SRLDC: 'own',  NRLDC: 'own',  ERLDC: 'own',  WRLDC: 'own',  NERLDC: 'own' },
      { label: 'Create Project',        ADMIN: true,   NLDC: true,   SRLDC: true,   NRLDC: true,   ERLDC: true,   WRLDC: true,   NERLDC: true  },
      { label: 'Edit Project',          ADMIN: true,   NLDC: true,   SRLDC: 'own',  NRLDC: 'own',  ERLDC: 'own',  WRLDC: 'own',  NERLDC: 'own' },
      { label: 'Delete Project',        ADMIN: true,   NLDC: true,   SRLDC: 'own',  NRLDC: 'own',  ERLDC: 'own',  WRLDC: 'own',  NERLDC: 'own' },
      { label: 'Add Phases',            ADMIN: true,   NLDC: true,   SRLDC: 'own',  NRLDC: 'own',  ERLDC: 'own',  WRLDC: 'own',  NERLDC: 'own' },
      { label: 'Add Project Notes',     ADMIN: true,   NLDC: true,   SRLDC: 'own',  NRLDC: 'own',  ERLDC: 'own',  WRLDC: 'own',  NERLDC: 'own' },
    ],
  },
  {
    section: 'Transmission Elements',
    items: [
      { label: 'View All Elements',     ADMIN: true,   NLDC: true,   SRLDC: 'own',  NRLDC: 'own',  ERLDC: 'own',  WRLDC: 'own',  NERLDC: 'own' },
      { label: 'Create Element',        ADMIN: true,   NLDC: true,   SRLDC: true,   NRLDC: true,   ERLDC: true,   WRLDC: true,   NERLDC: true  },
      { label: 'Edit Element',          ADMIN: true,   NLDC: true,   SRLDC: 'own',  NRLDC: 'own',  ERLDC: 'own',  WRLDC: 'own',  NERLDC: 'own' },
      { label: 'Delete Element',        ADMIN: true,   NLDC: true,   SRLDC: 'own',  NRLDC: 'own',  ERLDC: 'own',  WRLDC: 'own',  NERLDC: 'own' },
    ],
  },
  {
    section: 'Administration',
    items: [
      { label: 'User Management',       ADMIN: true,   NLDC: false,  SRLDC: false,  NRLDC: false,  ERLDC: false,  WRLDC: false,  NERLDC: false },
      { label: 'Access Control View',   ADMIN: true,   NLDC: true,   SRLDC: false,  NRLDC: false,  ERLDC: false,  WRLDC: false,  NERLDC: false },
      { label: 'Create / Edit Users',   ADMIN: true,   NLDC: false,  SRLDC: false,  NRLDC: false,  ERLDC: false,  WRLDC: false,  NERLDC: false },
      { label: 'Settings',              ADMIN: true,   NLDC: false,  SRLDC: false,  NRLDC: false,  ERLDC: false,  WRLDC: false,  NERLDC: false },
    ],
  },
];

const REGION_MAP = [
  { role: 'ADMIN',  region: '—',   description: 'All regions, full privileges' },
  { role: 'NLDC',   region: '—',   description: 'National role — full edit across all regions (except administration)' },
  { role: 'SRLDC',  region: 'SR',  description: 'Southern Region data only' },
  { role: 'NRLDC',  region: 'NR',  description: 'Northern Region data only' },
  { role: 'ERLDC',  region: 'ER',  description: 'Eastern Region data only' },
  { role: 'WRLDC',  region: 'WR',  description: 'Western Region data only' },
  { role: 'NERLDC', region: 'NER', description: 'North-Eastern Region data only' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function PermCell({ value }) {
  if (value === true) return (
    <td className="px-3 py-2.5 text-center">
      <CheckCircle2 className="size-4 text-emerald-500 mx-auto" />
    </td>
  );
  if (value === false) return (
    <td className="px-3 py-2.5 text-center">
      <XCircle className="size-4 text-muted-foreground/30 mx-auto" />
    </td>
  );
  // 'own' = region-scoped
  return (
    <td className="px-3 py-2.5 text-center">
      <span className="inline-flex items-center justify-center size-5 rounded-full bg-amber-100 text-amber-700 text-[9px] font-bold mx-auto">R</span>
    </td>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function AccessControlClient({ currentRole }) {
  return (
    <div className="px-4 lg:px-6 pb-8 space-y-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="size-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
          <Shield className="size-5 text-blue-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Access Control</h1>
          <p className="text-sm text-muted-foreground">Role-based permissions and region assignments for the FTC portal</p>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-muted/20 px-4 py-3 text-xs">
        <span className="font-semibold text-foreground">Legend:</span>
        <span className="flex items-center gap-1.5"><CheckCircle2 className="size-3.5 text-emerald-500" /> Full access</span>
        <span className="flex items-center gap-1.5">
          <span className="inline-flex items-center justify-center size-4 rounded-full bg-amber-100 text-amber-700 text-[9px] font-bold">R</span>
          Region-scoped (own region only)
        </span>
        <span className="flex items-center gap-1.5"><XCircle className="size-3.5 text-muted-foreground/40" /> No access</span>
      </div>

      {/* Role cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">
        {ROLES.map((role) => {
          const m = ROLE_META[role];
          return (
            <div key={role} className={`rounded-xl border px-3 py-3 ${m.color} ${currentRole === role ? 'ring-2 ring-primary/40' : ''}`}>
              <div className="flex items-center gap-1.5 mb-1">
                <span className={`size-2 rounded-full ${m.dot}`} />
                <span className="text-[11px] font-bold">{role}</span>
                {currentRole === role && <span className="text-[9px] font-bold bg-primary/15 text-primary rounded-full px-1.5 py-0.5 ml-auto">YOU</span>}
              </div>
              <p className="text-[10px] opacity-80 leading-snug">{m.label}</p>
            </div>
          );
        })}
      </div>

      {/* Permissions matrix */}
      <div className="rounded-xl border bg-card overflow-hidden shadow-xs">
        <div className="px-4 py-3 border-b bg-muted/20 flex items-center gap-2">
          <Shield className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Permissions Matrix</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead className="bg-muted/10 border-b border-border">
              <tr>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Action</th>
                {ROLES.map((role) => (
                  <th key={role} className={`px-3 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide ${currentRole === role ? 'text-primary' : 'text-muted-foreground'}`}>
                    {role}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map((section) => (
                <React.Fragment key={section.section}>
                  <tr className="bg-muted/20 border-y border-border">
                    <td colSpan={ROLES.length + 1} className="px-4 py-1.5">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{section.section}</span>
                    </td>
                  </tr>
                  {section.items.map((item) => (
                    <tr key={item.label} className="border-b border-border/50 hover:bg-muted/10 transition-colors">
                      <td className="px-4 py-2.5 text-sm text-foreground">{item.label}</td>
                      {ROLES.map((role) => <PermCell key={role} value={item[role]} />)}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Region assignment table */}
      <div className="rounded-xl border bg-card overflow-hidden shadow-xs">
        <div className="px-4 py-3 border-b bg-muted/20 flex items-center gap-2">
          <Info className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Role → Region Assignment</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/10 border-b border-border">
              <tr>
                {['Role', 'Region Code', 'Scope Description'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {REGION_MAP.map((row) => {
                const m = ROLE_META[row.role];
                return (
                  <tr key={row.role} className={`hover:bg-muted/10 transition-colors ${currentRole === row.role ? 'bg-primary/[0.03]' : ''}`}>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${m.color}`}>
                        {row.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-sm font-semibold text-foreground">{row.region}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{row.description}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 border-t bg-muted/10">
          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <AlertCircle className="size-3.5" />
            Region scoping is enforced server-side. RLDC users cannot query, create, or modify data outside their assigned region.
          </p>
        </div>
      </div>
    </div>
  );
}
