'use client';

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Layers, Zap, Plus, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { FtcTable } from '@/components/grid/FtcTable';
import { ProjectDetailModal } from '@/components/grid/ProjectDetailModal';
import { AddPhasesForm } from '@/components/grid/AddPhasesForm';
import { CreateProjectForm } from '@/components/grid/CreateProjectForm';
import { FtcExportButtons } from '@/components/grid/FtcExportButtons';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody,
} from '@/components/ui/dialog';
import { useSettings } from '@/providers/settings-provider';

function fmtRefMonth(ym) {
  if (!ym) return 'Expected';
  try {
    const d = new Date(`${ym}-01`);
    const month = d.toLocaleString('en-US', { month: 'short' });
    const year  = String(d.getFullYear()).slice(2);
    return `Exp. ${month}'${year}`;
  } catch { return 'Expected'; }
}

export function FtcPageClient({
  projects, allClearedProjects = [], userRole, regionLabel, asOf = null,
  regions = [], plantTypes = [], poolingStations = [], stations = [], lockedRegionId = null,
}) {
  const [phaseOpen, setPhaseOpen]                 = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [mode, setMode]                           = useState('pick'); // 'pick' | 'create'
  const [detailProject, setDetailProject]         = useState(null);
  // Rows currently visible in the table (after region/type/status/search
  // filters) — kept in sync by FtcTable so the PDF / Excel export the same set.
  const [visibleProjects, setVisibleProjects]     = useState(projects);
  const handleVisibleChange = useCallback((rows) => setVisibleProjects(rows), []);
  const router = useRouter();
  const { settings } = useSettings();
  const refMonthLabel = fmtRefMonth(settings.referenceMonth);

  const canEdit = ['ADMIN', 'NLDC', 'SRLDC', 'NRLDC', 'ERLDC', 'WRLDC', 'NERLDC'].includes(userRole);

  const selectedProject = useMemo(
    () => allClearedProjects.find((p) => p.id === selectedProjectId) ?? null,
    [allClearedProjects, selectedProjectId]
  );

  function handlePhaseClose() {
    setPhaseOpen(false);
    setSelectedProjectId('');
    setMode('pick');
  }

  return (
    <div className="px-6 pt-3 pb-3 space-y-2 flex flex-col h-[calc(100vh-150px)] min-h-0">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="size-8 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
            <Zap className="size-4 text-blue-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">
              Generation Capacity Under Process of FTC
            </h1>
            <p className="text-[12px] text-muted-foreground leading-tight">{regionLabel}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canEdit && (
            <Button variant="outline" onClick={() => setPhaseOpen(true)}>
              <Layers className="size-4 mr-2" />
              Add Source / Component
            </Button>
          )}
          <FtcExportButtons
            projects={visibleProjects}
            regionLabel={regionLabel}
            refMonthLabel={refMonthLabel}
            asOf={asOf}
            size="sm"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <FtcTable
          projects={projects}
          userRole={userRole}
          onView={setDetailProject}
          refMonthLabel={refMonthLabel}
          onVisibleChange={handleVisibleChange}
        />
      </div>

      {/* Add Phase modal */}
      <Dialog open={phaseOpen} onOpenChange={(o) => { if (!o) handlePhaseClose(); }}>
        {/* overflow-y-visible: don't clip the project-picker dropdown (which is
            portaled into this dialog); the scroll for tall forms lives on the
            DialogBody below instead. */}
        <DialogContent className="max-w-4xl overflow-y-visible">
          <DialogHeader>
            <DialogTitle>
              {mode === 'create' ? 'Create New Generating Station' : 'Add Source / Component'}
            </DialogTitle>
            {mode === 'pick' && !selectedProject && (
              <DialogDescription>
                Pick a project and record its FTC / TOC / COD data — or create a
                new generating station. Recording commissioning data enters the
                project into the FTC pipeline; its CONTD-4 status is independent.
              </DialogDescription>
            )}
          </DialogHeader>
          <DialogBody className="max-h-[72vh] overflow-y-auto">
            {mode === 'create' ? (
              <>
                <button
                  type="button"
                  onClick={() => setMode('pick')}
                  className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="size-3.5" /> Back to picking a project
                </button>
                <CreateProjectForm
                  regions={regions}
                  plantTypes={plantTypes}
                  poolingStations={poolingStations}
                  stations={stations}
                  lockedRegionId={lockedRegionId}
                  userRole={userRole}
                  onSuccess={(id) => { setSelectedProjectId(id); setMode('pick'); router.refresh(); }}
                  onCancel={() => setMode('pick')}
                />
              </>
            ) : selectedProjectId && !selectedProject ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Loading new project…</div>
            ) : !selectedProject ? (
              <div className="mb-2">
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Generating Station
                </label>
                <Combobox
                  value={selectedProjectId}
                  onChange={setSelectedProjectId}
                  placeholder="— Select a project —"
                  searchPlaceholder="Search by name, region, or capacity…"
                  emptyText="No matching projects."
                  options={allClearedProjects.map((p) => {
                    // Tag projects not yet in the pipeline so the user knows
                    // selecting one will bring it into FTC.
                    const inPipeline = p.inFtcPipeline || p.contd4Status === 'CLEARED';
                    const tag = inPipeline ? '' : '  • new to FTC';
                    return {
                      value: p.id,
                      label: `${p.name} (${p.region.code}) — ${p.totalCapacityMw.toFixed(1)} MW${tag}`,
                    };
                  })}
                />
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setMode('create')}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700"
                  >
                    <Plus className="size-3.5" /> Not in the list? Create a new generating station
                  </button>
                )}
              </div>
            ) : (
              // Collapse the picker into a compact bar so the form is in view
              // immediately (no scrolling up to re-reach the dropdown).
              <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Project</p>
                  <p className="text-sm font-semibold text-foreground truncate">
                    {selectedProject.name}
                    <span className="font-normal text-muted-foreground"> · {selectedProject.region.code} · {selectedProject.totalCapacityMw.toFixed(1)} MW</span>
                  </p>
                </div>
                <Button variant="outline" size="sm" className="shrink-0" onClick={() => setSelectedProjectId('')}>
                  Change
                </Button>
              </div>
            )}

            {mode === 'pick' && selectedProject && !(selectedProject.inFtcPipeline || selectedProject.contd4Status === 'CLEARED') && (
              <p className="mb-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                This project isn't in the FTC pipeline yet. Saving its commissioning
                data will add it — independent of its CONTD-4 status
                ({selectedProject.contd4Status ?? 'no CONTD-4'}).
              </p>
            )}

            {mode === 'pick' && selectedProject && (
              <AddPhasesForm
                projectId={selectedProject.id}
                totalCapacityMw={selectedProject.totalCapacityMw}
                existingCodMw={selectedProject.phases.reduce((s, ph) => s + (ph.codDeclaredMw ?? 0), 0)}
                plantType={selectedProject.plantType}
                isIntrastate={!!selectedProject.isIntrastate}
                windCapacityMw={selectedProject.windCapacityMw}
                solarCapacityMw={selectedProject.solarCapacityMw}
                bessCapacityMw={selectedProject.bessCapacityMw}
                pspCapacityMw={selectedProject.pspCapacityMw}
                existingPhases={selectedProject.phases}
                sourceUsed={selectedProject.phases.reduce((acc, ph) => {
                  acc[ph.sourceType] = (acc[ph.sourceType] ?? 0) + (ph.capacityAppliedMw ?? 0);
                  return acc;
                }, {})}
                userRole={userRole}
                onSuccess={() => { handlePhaseClose(); router.refresh(); }}
                onCancel={handlePhaseClose}
              />
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>

      {/* Project Detail modal — re-resolve the project from the latest
          `projects` prop on every render so router.refresh() inside the
          modal (e.g. phase add/edit/delete) reflects immediately without
          remount. Falls back to the stored snapshot if the project was
          deleted/deactivated underneath. */}
      <ProjectDetailModal
        project={detailProject ? (projects.find((p) => p.id === detailProject.id) ?? detailProject) : null}
        open={!!detailProject}
        onOpenChange={(o) => { if (!o) setDetailProject(null); }}
        canEdit={canEdit}
        userRole={userRole}
      />
    </div>
  );
}
