'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, GitMerge } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { HybridFtcTable } from '@/components/grid/HybridFtcTable';
import { ProjectDetailModal } from '@/components/grid/ProjectDetailModal';
import { AddPhasesForm } from '@/components/grid/AddPhasesForm';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody,
} from '@/components/ui/dialog';

export function HybridFtcPageClient({ projects, userRole, regionLabel }) {
  const [logOpen, setLogOpen]                     = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [detailProject, setDetailProject]         = useState(null);
  const router = useRouter();

  const canEdit = ['ADMIN', 'SRLDC', 'NRLDC', 'ERLDC', 'WRLDC', 'NERLDC'].includes(userRole);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

  function handleLogClose() {
    setLogOpen(false);
    setSelectedProjectId('');
  }

  return (
    <div className="px-6 pt-3 pb-3 space-y-2 flex flex-col h-[calc(100vh-150px)] min-h-0">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="size-8 rounded-lg bg-violet-50 flex items-center justify-center shrink-0">
            <GitMerge className="size-4 text-violet-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">
              Source-wise Segregation of Hybrid Generation FTC
            </h1>
            <p className="text-[12px] text-muted-foreground leading-tight">{regionLabel}</p>
          </div>
        </div>

        {canEdit && (
          <Button onClick={() => setLogOpen(true)}>
            <Plus className="size-4 mr-2" />
            Log Phase
          </Button>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <HybridFtcTable
          projects={projects}
          userRole={userRole}
          onView={setDetailProject}
        />
      </div>

      {/* Log Phase modal */}
      <Dialog open={logOpen} onOpenChange={(o) => { if (!o) handleLogClose(); }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Log Hybrid Commissioning Phase</DialogTitle>
            <DialogDescription>
              Select a hybrid project, then record its source-wise FTC / TOC / COD milestone data.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="mb-5">
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Hybrid Generating Station
              </label>
              <Combobox
                value={selectedProjectId}
                onChange={setSelectedProjectId}
                placeholder="— Select a project —"
                searchPlaceholder="Search by name, region, or hybrid type…"
                emptyText="No matching projects."
                options={projects.map((p) => ({
                  value: p.id,
                  label: `${p.name} (${p.region.code}) — ${p.totalCapacityMw.toFixed(1)} MW · ${p.plantType.label}`,
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
                sourceUsed={selectedProject.phases.reduce((acc, ph) => {
                  acc[ph.sourceType] = (acc[ph.sourceType] ?? 0) + (ph.capacityAppliedMw ?? 0);
                  return acc;
                }, {})}
                onSuccess={() => { handleLogClose(); router.refresh(); }}
                onCancel={handleLogClose}
              />
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>

      {/* Project Detail modal — re-resolve from latest props so an in-modal
          router.refresh() updates the displayed data without remount. */}
      <ProjectDetailModal
        project={detailProject ? (projects.find((p) => p.id === detailProject.id) ?? detailProject) : null}
        open={!!detailProject}
        onOpenChange={(o) => { if (!o) setDetailProject(null); }}
        canEdit={canEdit}
      />
    </div>
  );
}
