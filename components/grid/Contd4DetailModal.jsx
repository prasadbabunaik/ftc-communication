'use client';

import { FileText, X } from 'lucide-react';
import { Contd4Card } from '@/components/grid/Contd4Card';
import { AuditFeed } from '@/components/grid/AuditFeed';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

function InfoRow({ label, value }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-sm text-foreground">{value ?? '—'}</p>
    </div>
  );
}

const STATUS_COLORS = {
  PENDING:  'bg-amber-50 text-amber-700 border-amber-200',
  RECEIVED: 'bg-blue-50 text-blue-700 border-blue-200',
  CLEARED:  'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
};

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
              {project.developerName && (
                <p className="text-xs text-muted-foreground font-medium mb-0.5">{project.developerName}</p>
              )}
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
                    CONTD-4: {project.contd4.status}
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
          <div className="rounded-xl border bg-muted/20 px-5 py-4 grid grid-cols-4 gap-6">
            <InfoRow label="Developer"       value={project.developerName} />
            <InfoRow label="Region"          value={`${project.region.code} — ${project.region.name}`} />
            <InfoRow label="Pooling Station" value={project.poolingStation?.name} />
            <InfoRow label="Total Capacity"  value={`${Number(project.totalCapacityMw).toFixed(1)} MW`} />
          </div>

          {/* Hybrid breakdown */}
          {project.plantType.isHybrid && (
            <div className="rounded-xl border bg-card p-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Hybrid Capacity Breakdown
              </p>
              <div className="flex gap-8">
                {project.windCapacityMw  != null && (
                  <div>
                    <p className="text-xs text-muted-foreground">Wind</p>
                    <p className="font-semibold text-sm">{Number(project.windCapacityMw).toFixed(1)} MW</p>
                  </div>
                )}
                {project.solarCapacityMw != null && (
                  <div>
                    <p className="text-xs text-muted-foreground">Solar</p>
                    <p className="font-semibold text-sm">{Number(project.solarCapacityMw).toFixed(1)} MW</p>
                  </div>
                )}
                {project.bessCapacityMw  != null && (
                  <div>
                    <p className="text-xs text-muted-foreground">BESS</p>
                    <p className="font-semibold text-sm">{Number(project.bessCapacityMw).toFixed(1)} MW</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* CONTD-4 application — the only tracking section here */}
          <Contd4Card
            contd4={project.contd4}
            projectId={project.id}
            canEdit={canEdit}
            userRole={userRole}
            regionCode={project.region.code}
            onClose={() => onOpenChange(false)}
          />

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
