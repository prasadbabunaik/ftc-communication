'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Cable, X, Pencil, History, Clock, ArrowRight } from 'lucide-react';
import { AddTransmissionForm } from '@/components/grid/AddTransmissionForm';
import { ProjectHistory } from '@/components/grid/ProjectHistory';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

const ACTION_COLORS = {
  CREATE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  UPDATE: 'bg-blue-50 text-blue-700 border-blue-200',
  DELETE: 'bg-red-50 text-red-700 border-red-200',
};

function TxAuditEntry({ log }) {
  if (log.field) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-1.5">
            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold border ${ACTION_COLORS[log.action] ?? 'bg-muted'}`}>
              {log.action}
            </span>
            <span className="text-xs font-medium text-foreground">{log.field}</span>
          </div>
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
            <Clock className="size-2.5" />
            {fmtDateTime(log.createdAt)}
          </span>
        </div>
        <div className="ml-5 flex items-center gap-1.5 flex-wrap">
          {log.oldValue && (
            <span className="text-[11px] text-red-600 bg-red-50 border border-red-100 rounded px-1.5 py-0.5 line-through">{log.oldValue}</span>
          )}
          {log.oldValue && <ArrowRight className="size-3 text-muted-foreground shrink-0" />}
          <span className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded px-1.5 py-0.5 font-medium">{log.newValue || '—'}</span>
        </div>
        <p className="ml-5 mt-1 text-[10px] text-muted-foreground/60">by {log.user?.name ?? 'System'}</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5">
          <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold border ${ACTION_COLORS[log.action] ?? 'bg-muted'}`}>
            {log.action}
          </span>
          <span className="text-xs font-medium text-foreground">{log.newValue ?? log.oldValue ?? 'Element changed'}</span>
        </div>
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
          <Clock className="size-2.5" />
          {fmtDateTime(log.createdAt)}
        </span>
      </div>
      <p className="ml-5 text-[10px] text-muted-foreground/60">by {log.user?.name ?? 'System'}</p>
    </div>
  );
}

const TYPE_COLORS = {
  LINE: 'bg-blue-50 text-blue-700 border-blue-200',
  ICT:  'bg-purple-50 text-purple-700 border-purple-200',
  GT:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  ST:   'bg-stone-50 text-stone-700 border-stone-200',
};

function fmt(date) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function InfoRow({ label, value }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-sm text-foreground">{value ?? '—'}</p>
    </div>
  );
}

export function TransmissionDetailModal({ element, open, onOpenChange, canEdit, regions, userRole }) {
  const [editing, setEditing] = useState(false);
  const [tab, setTab]         = useState('details');
  const router = useRouter();

  if (!element) return null;
  const auditLogs = element.auditLogs ?? [];

  function handleClose() {
    onOpenChange(false);
    setEditing(false);
    setTab('details');
  }

  function handleEditSuccess() {
    setEditing(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-4xl w-full" showClose={false}>

        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-start gap-3">
            <div className="size-9 rounded-lg bg-purple-50 flex items-center justify-center shrink-0 mt-0.5">
              <Cable className="size-5 text-purple-600" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-foreground leading-tight">
                {editing ? 'Edit Transmission Element' : element.elementName}
              </DialogTitle>
              {!editing && (
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                    {element.region.code}
                  </span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${TYPE_COLORS[element.elementType]}`}>
                    {element.elementType}
                  </span>
                  {element.isRe && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border bg-green-50 text-green-700 border-green-200">
                      RE
                    </span>
                  )}
                  {element.pendingFtc && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border bg-amber-50 text-amber-700 border-amber-200">
                      Pending FTC
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!editing && canEdit && (
              <Button size="sm" variant="outline" onClick={() => { setEditing(true); setTab('details'); }}>
                <Pencil className="size-3.5 mr-1.5" />
                Edit
              </Button>
            )}
            <button
              onClick={handleClose}
              className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Tab bar — only show when not editing */}
        {!editing && (
          <div className="flex border-b px-6">
            {[
              { id: 'details', label: 'Details' },
              { id: 'history', label: `History${auditLogs.length > 0 ? ` (${auditLogs.length})` : ''}` },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors -mb-px ${
                  tab === t.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="px-6 py-5 overflow-y-auto max-h-[65vh]">
          {editing ? (
            <AddTransmissionForm
              element={element}
              regions={regions}
              lockedRegionId={null}
              userRole={userRole}
              onSuccess={handleEditSuccess}
              onCancel={() => setEditing(false)}
            />
          ) : tab === 'history' ? (
            <div className="space-y-2">
              {auditLogs.length === 0 ? (
                <div className="py-10 text-center">
                  <History className="size-8 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No change history yet.</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Changes will appear here after the element is edited.</p>
                </div>
              ) : (
                [...auditLogs].reverse().map((log) => <TxAuditEntry key={log.id} log={log} />)
              )}
            </div>
          ) : (
            <div className="space-y-5">
              {/* Identity grid */}
              <div className="rounded-xl border bg-muted/20 px-5 py-4 grid grid-cols-4 gap-x-8 gap-y-4">
                <InfoRow label="Agency / Owner"  value={element.agencyOwner} />
                <InfoRow label="Region"          value={`${element.region.code} — ${element.region.name}`} />
                <InfoRow label="Type"            value={element.elementType} />
                <InfoRow label="RE / Non-RE"     value={element.isRe ? 'Renewable Energy (RE)' : 'Non-RE'} />
                <InfoRow label="Voltage (kV)"    value={element.voltageRatingKv ?? '—'} />
                <InfoRow label="Capacity (MVA)"  value={element.capacityMva != null ? `${Number(element.capacityMva).toFixed(1)} MVA` : '—'} />
                <InfoRow label="Line Length (km)" value={element.lineLengthKm != null ? `${Number(element.lineLengthKm).toFixed(3)} km` : '—'} />
                <InfoRow label="First Energization" value={fmt(element.firstEnergyDate)} />
              </div>

              {/* FTC status */}
              <div className="rounded-xl border bg-card px-5 py-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">FTC Status</p>
                <div className="grid grid-cols-4 gap-x-8 gap-y-4">
                  <div>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Pending FTC</p>
                    {element.pendingFtc
                      ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border bg-amber-50 text-amber-700 border-amber-200">Yes</span>
                      : <span className="text-sm text-muted-foreground">No</span>}
                  </div>
                  <InfoRow label="Proposed FTC Date"          value={fmt(element.proposedFtcDate)} />
                  <InfoRow label="Capacity to Commission (MVA)" value={element.capacityApr26Mva != null ? `${Number(element.capacityApr26Mva).toFixed(1)} MVA` : '—'} />
                  <InfoRow label="Length to Commission (km)"  value={element.lineLengthApr26Km != null ? `${Number(element.lineLengthApr26Km).toFixed(3)} km` : '—'} />
                </div>
              </div>

              {/* Remarks */}
              {element.remarks && (
                <div className="rounded-xl border bg-card px-5 py-4">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Remarks</p>
                  <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{element.remarks}</p>
                </div>
              )}

              {/* Day-wise history */}
              <ProjectHistory name={element.elementName} region={element.region.code} kind="tx" />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
