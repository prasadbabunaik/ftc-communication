'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Layers, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { FtcTable } from '@/components/grid/FtcTable';
import { ProjectDetailModal } from '@/components/grid/ProjectDetailModal';
import { AddPhasesForm } from '@/components/grid/AddPhasesForm';
import { ExportButtons } from '@/components/grid/ExportButtons';
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

export function FtcPageClient({ projects, allClearedProjects = [], userRole, regionLabel }) {
  const [phaseOpen, setPhaseOpen]                 = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [detailProject, setDetailProject]         = useState(null);
  const router = useRouter();
  const { settings } = useSettings();
  const refMonthLabel = fmtRefMonth(settings.referenceMonth);

  const canEdit = ['ADMIN', 'SRLDC', 'NRLDC', 'ERLDC', 'WRLDC', 'NERLDC'].includes(userRole);

  const selectedProject = useMemo(
    () => allClearedProjects.find((p) => p.id === selectedProjectId) ?? null,
    [allClearedProjects, selectedProjectId]
  );

  function handlePhaseClose() {
    setPhaseOpen(false);
    setSelectedProjectId('');
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
              Add Commissioning Phase
            </Button>
          )}
          <ExportButtons size="sm" />
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <FtcTable
          projects={projects}
          userRole={userRole}
          onView={setDetailProject}
          refMonthLabel={refMonthLabel}
        />
      </div>

      {/* Add Phase modal */}
      <Dialog open={phaseOpen} onOpenChange={(o) => { if (!o) handlePhaseClose(); }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Add Commissioning Phase</DialogTitle>
            <DialogDescription>
              Select a cleared project, then record its FTC / TOC / COD milestone data.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="mb-5">
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Generating Station
              </label>
              <Combobox
                value={selectedProjectId}
                onChange={setSelectedProjectId}
                placeholder="— Select a project —"
                searchPlaceholder="Search by name, region, or capacity…"
                emptyText="No matching projects."
                options={allClearedProjects.map((p) => ({
                  value: p.id,
                  label: `${p.name} (${p.region.code}) — ${p.totalCapacityMw.toFixed(1)} MW`,
                }))}
              />
            </div>

            {selectedProject && (
              <AddPhasesForm
                projectId={selectedProject.id}
                totalCapacityMw={selectedProject.totalCapacityMw}
                existingCodMw={selectedProject.phases.reduce((s, ph) => s + (ph.codDeclaredMw ?? 0), 0)}
                plantType={selectedProject.plantType}
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
