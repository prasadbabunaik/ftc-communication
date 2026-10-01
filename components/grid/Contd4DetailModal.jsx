'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, X, Pencil, Check } from 'lucide-react';
import { toast } from 'sonner';
import { updateProjectCapacities } from '@/app/actions/grid';
import { Contd4Card } from '@/components/grid/Contd4Card';
import { HybridCapacityEditor } from '@/components/grid/HybridCapacityEditor';
import { Contd4Attachments } from '@/components/grid/Contd4Attachments';
import { AuditFeed } from '@/components/grid/AuditFeed';
import { ProjectHistory } from '@/components/grid/ProjectHistory';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { CONTD4_STATUS_LABEL, CONTD4_STATUS_BADGE as STATUS_COLORS } from '@/lib/grid-computations';

function InfoRow({ label, value }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-sm text-foreground">{value ?? '—'}</p>
    </div>
  );
}

// Total Capacity is the ceiling the server enforces on CONTD-4 Issued, so it has
// to be adjustable from here — otherwise raising the issued figure is a dead end
// (the only other edit surfaces are the FTC phase editor and an unlinked page).
// Hybrids are excluded: their total is derived from the per-component editor
// below, so editing it standalone would desync the two.
function TotalCapacityCell({ project, canEdit }) {
  const router = useRouter();
  const current = Number(project.totalCapacityMw ?? 0);
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const [saving, setSaving] = useState(false);

  const isHybrid = !!project.plantType?.isHybrid;
  const canChange = canEdit && !isHybrid;

  async function save() {
    const n = parseFloat(val);
    if (!Number.isFinite(n) || n <= 0) { toast.error('Total Capacity must be a positive number.'); return; }
    if (Math.abs(n - current) < 0.001) { setEditing(false); return; }
    setSaving(true);
    const res = await updateProjectCapacities(project.id, { totalCapacityMw: n });
    setSaving(false);
    if (res?.error) { toast.error(res.error); return; }
    toast.success('Total Capacity updated.');
    setEditing(false);
    router.refresh();
  }

  return (
    <div>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Total Capacity</p>
      {editing ? (
        <span className="flex items-center gap-1.5">
          <input
            autoFocus
            type="number"
            step="0.01"
            min="0"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
            disabled={saving}
            className="w-28 rounded-md border border-input px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="text-xs text-muted-foreground">MW</span>
          <button type="button" onClick={save} disabled={saving} title="Save" className="text-emerald-600 hover:text-emerald-700 disabled:opacity-50"><Check className="size-4" /></button>
          <button type="button" onClick={() => setEditing(false)} disabled={saving} title="Cancel" className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
        </span>
      ) : (
        <span className="flex items-center gap-1.5">
          <span className="text-sm text-foreground">{current.toFixed(1)} MW</span>
          {canChange && (
            <button
              type="button"
              onClick={() => { setVal(String(current)); setEditing(true); }}
              title="Edit total capacity"
              className="text-muted-foreground hover:text-primary transition-colors"
            >
              <Pencil className="size-3.5" />
            </button>
          )}
        </span>
      )}
      {isHybrid && canEdit && (
        <p className="text-[10px] text-muted-foreground mt-0.5">Set via the component breakdown below</p>
      )}
    </div>
  );
}


export function Contd4DetailModal({ project, open, onOpenChange, canEdit, userRole }) {
  if (!project) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-full" showClose={false}>

        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-start gap-3">
            <div className="size-9 rounded-lg bg-amber-50 flex items-center justify-center shrink-0 mt-0.5">
              <FileText className="size-5 text-amber-600" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-foreground leading-tight">
                {project.name}
              </DialogTitle>
              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                  {project.region.code}
                </span>
                <span className="text-xs text-muted-foreground">{project.plantType.label}</span>
                {project.poolingStation && (
                  <span className="text-xs text-muted-foreground">· {project.poolingStation.name}</span>
                )}
                {project.contd4 && (
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${STATUS_COLORS[project.contd4.status]}`}>
                    CONTD-4: {CONTD4_STATUS_LABEL[project.contd4.status] ?? project.contd4.status}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4 overflow-y-auto max-h-[75vh]">

          {/* Project summary strip */}
          <div className="rounded-xl border bg-muted/20 px-5 py-4 grid grid-cols-3 gap-6">
            <InfoRow label="Region"          value={`${project.region.code} — ${project.region.name}`} />
            <InfoRow label="Pooling Station" value={project.poolingStation?.name} />
            <TotalCapacityCell project={project} canEdit={canEdit} />
          </div>

          {/* Hybrid breakdown — editable (Wind/Solar/BESS) */}
          {project.plantType.isHybrid && (
            <HybridCapacityEditor project={project} canEdit={canEdit} />
          )}

          {/* CONTD-4 application — the only tracking section here */}
          <Contd4Card
            contd4={project.contd4}
            projectId={project.id}
            canEdit={canEdit}
            userRole={userRole}
            regionCode={project.region.code}
            notes={project.notes ?? []}
            totalCapacityMw={project.totalCapacityMw}
            onClose={() => onOpenChange(false)}
          />

          {/* Project documents — file uploads with remarks, independent of the
              CONTD-4 application record */}
          <Contd4Attachments
            projectId={project.id}
            attachments={project.attachments ?? []}
            canEdit={canEdit}
          />

          {/* Day-wise CONTD-4 history */}
          <ProjectHistory name={project.name} region={project.region.code} kind="contd4" />

          {/* Engineering notes / issues log */}
          <div className="rounded-xl border bg-card overflow-hidden">
            <div className="px-5 py-3 border-b bg-muted/20">
              <h2 className="text-sm font-semibold text-foreground">Activity &amp; Notes</h2>
            </div>
            <div className="px-5 py-4">
              <AuditFeed
                projectId={project.id}
                notes={project.notes ?? []}
                canAdd={canEdit}
              />
            </div>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}
