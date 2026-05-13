'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Layers, Plus, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FtcTable } from '@/components/grid/FtcTable';
import { ProjectDetailModal } from '@/components/grid/ProjectDetailModal';
import { AddPhasesForm } from '@/components/grid/AddPhasesForm';
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
    <div className="p-6 space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
            <Zap className="size-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">
              Generation Capacity Under Process of FTC
            </h1>
            <p className="text-sm text-muted-foreground">{regionLabel}</p>
          </div>
        </div>

        {canEdit && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setPhaseOpen(true)}>
              <Layers className="size-4 mr-2" />
              Add Phase
            </Button>
            <Button asChild>
              <Link href="/generation/new">
                <Plus className="size-4 mr-2" />
                Add Project
              </Link>
            </Button>
          </div>
        )}
      </div>

      <FtcTable
        projects={projects}
        userRole={userRole}
        onView={setDetailProject}
        refMonthLabel={refMonthLabel}
      />

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
              <select
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
              >
                <option value="">— Select a project —</option>
                {allClearedProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.region.code}) — {p.totalCapacityMw.toFixed(1)} MW
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
                existingPhases={selectedProject.phases}
                sourceUsed={selectedProject.phases.reduce((acc, ph) => {
                  acc[ph.sourceType] = (acc[ph.sourceType] ?? 0) + (ph.capacityAppliedMw ?? 0);
                  return acc;
                }, {})}
                onSuccess={() => { handlePhaseClose(); router.refresh(); }}
                onCancel={handlePhaseClose}
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
