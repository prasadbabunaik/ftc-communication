'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, GitMerge } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
    <div className="p-6 space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-lg bg-violet-50 flex items-center justify-center shrink-0">
            <GitMerge className="size-5 text-violet-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">
              Source-wise Segregation of Hybrid Generation FTC
            </h1>
            <p className="text-sm text-muted-foreground">{regionLabel}</p>
          </div>
        </div>

        {canEdit && (
          <Button onClick={() => setLogOpen(true)}>
            <Plus className="size-4 mr-2" />
            Log Phase
          </Button>
        )}
      </div>

      <HybridFtcTable
        projects={projects}
        userRole={userRole}
        onView={setDetailProject}
      />

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
              <select
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
              >
                <option value="">— Select a project —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.region.code}) — {p.totalCapacityMw.toFixed(1)} MW · {p.plantType.label}
                  </option>
                ))}
              </select>
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

      {/* Project Detail modal */}
      <ProjectDetailModal
        project={detailProject}
        open={!!detailProject}
        onOpenChange={(o) => { if (!o) setDetailProject(null); }}
        canEdit={canEdit}
      />
    </div>
  );
}
