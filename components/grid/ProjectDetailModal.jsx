'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Zap, X, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Contd4Card } from '@/components/grid/Contd4Card';
import { ProjectPhaseTimeline } from '@/components/grid/ProjectPhaseTimeline';
import { AddPhasesForm } from '@/components/grid/AddPhasesForm';
import { AuditFeed } from '@/components/grid/AuditFeed';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

const STATUS_COLORS = {
  PENDING:  'bg-amber-50 text-amber-700 border-amber-200',
  RECEIVED: 'bg-blue-50 text-blue-700 border-blue-200',
  CLEARED:  'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
};

function SummaryCard({ label, value, sub, color }) {
  const styles = {
    blue:    { wrap: 'bg-blue-50 border-blue-100',       val: 'text-blue-700' },
    emerald: { wrap: 'bg-emerald-50 border-emerald-100', val: 'text-emerald-700' },
    amber:   { wrap: 'bg-amber-50 border-amber-100',     val: 'text-amber-700' },
  };
  const s = styles[color];
  return (
    <div className={`rounded-xl border p-4 ${s.wrap}`}>
      <p className="text-xs text-muted-foreground font-medium">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${s.val}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
    </div>
  );
}

function BreakdownItem({ label, mw }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold text-sm">{Number(mw).toFixed(1)} MW</p>
    </div>
  );
}

export function ProjectDetailModal({ project, open, onOpenChange, canEdit }) {
  const [view, setView] = useState('detail'); // 'detail' | 'add-phase'
  const router = useRouter();

  if (!project) return null;

  const commissionedMw    = project.phases.reduce((s, p) => s + (p.codDeclaredMw ?? 0), 0);
  const pendingCapacityMw = project.totalCapacityMw - commissionedMw;

  const sourceUsed = project.phases.reduce((acc, p) => {
    acc[p.sourceType] = (acc[p.sourceType] ?? 0) + (p.capacityAppliedMw ?? 0);
    return acc;
  }, {});

  function handleClose() {
    onOpenChange(false);
    setView('detail');
  }

  function handlePhaseSuccess() {
    handleClose();
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-4xl" showClose={false}>

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-start gap-3">
            {view === 'add-phase' && (
              <button
                onClick={() => setView('detail')}
                className="mt-0.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="size-5" />
              </button>
            )}
            <div className="flex items-start gap-3">
              <div className="size-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0 mt-0.5">
                <Zap className="size-5 text-blue-600" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold text-foreground leading-tight">
                  {view === 'add-phase' ? 'Add Commissioning Phase' : project.name}
                </DialogTitle>
                {view === 'detail' ? (
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
                ) : (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {project.name} · {project.region.code} · {project.plantType.label}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {view === 'detail' && canEdit && (
              <Button size="sm" onClick={() => setView('add-phase')}>
                <Plus className="size-3.5 mr-1.5" />
                Add Phase
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

        {/* ── Body ── */}
        <div className="px-6 py-5 overflow-y-auto max-h-[75vh]">

          {view === 'detail' && (
            <div className="space-y-5">
              {/* Capacity summary */}
              <div className="grid grid-cols-3 gap-3">
                <SummaryCard
                  label="Total Capacity"
                  value={`${project.totalCapacityMw.toFixed(1)} MW`}
                  sub={project.plantType.label}
                  color="blue"
                />
                <SummaryCard
                  label="Commissioned (COD)"
                  value={`${commissionedMw.toFixed(1)} MW`}
                  sub={`${Math.round((commissionedMw / project.totalCapacityMw) * 100) || 0}% complete`}
                  color="emerald"
                />
                <SummaryCard
                  label="Pending COD"
                  value={`${Math.max(0, pendingCapacityMw).toFixed(1)} MW`}
                  sub={pendingCapacityMw <= 0 ? 'Fully commissioned' : 'Remaining'}
                  color={pendingCapacityMw <= 0 ? 'emerald' : 'amber'}
                />
              </div>

              {/* Hybrid breakdown */}
              {project.plantType.isHybrid && (
                <div className="rounded-xl border bg-card p-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                    Hybrid Capacity Breakdown
                  </p>
                  <div className="flex gap-8">
                    {project.windCapacityMw  && <BreakdownItem label="Wind"  mw={project.windCapacityMw} />}
                    {project.solarCapacityMw && <BreakdownItem label="Solar" mw={project.solarCapacityMw} />}
                    {project.bessCapacityMw  && <BreakdownItem label="BESS"  mw={project.bessCapacityMw} />}
                  </div>
                </div>
              )}

              {/* CONTD-4 */}
              <Contd4Card contd4={project.contd4} projectId={project.id} canEdit={canEdit} />

              {/* Commissioning Phases */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-3">Commissioning Phases</h3>
                {project.phases.length === 0 ? (
                  <div className="rounded-xl border border-dashed bg-muted/10 p-8 text-center">
                    <Zap className="size-7 text-muted-foreground/40 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No commissioning phases yet.</p>
                    {canEdit && (
                      <Button size="sm" className="mt-3" onClick={() => setView('add-phase')}>
                        Add First Phase
                      </Button>
                    )}
                  </div>
                ) : (
                  <ProjectPhaseTimeline
                    phases={project.phases}
                    projectId={project.id}
                    canEdit={canEdit}
                    onEditSuccess={handleClose}
                  />
                )}
              </div>

              {/* Engineering Audit Feed */}
              <div className="rounded-xl border bg-card p-4">
                <AuditFeed
                  projectId={project.id}
                  notes={project.notes ?? []}
                  canAdd={true}
                />
              </div>
            </div>
          )}

          {view === 'add-phase' && (
            <AddPhasesForm
              projectId={project.id}
              totalCapacityMw={project.totalCapacityMw}
              existingCodMw={commissionedMw}
              plantType={project.plantType}
              windCapacityMw={project.windCapacityMw}
              solarCapacityMw={project.solarCapacityMw}
              bessCapacityMw={project.bessCapacityMw}
              existingPhases={project.phases}
              sourceUsed={sourceUsed}
              onSuccess={handlePhaseSuccess}
              onCancel={() => setView('detail')}
            />
          )}

        </div>
      </DialogContent>
    </Dialog>
  );
}
