'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Zap, GitBranch } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { GenerationTable } from '@/components/grid/GenerationTable';
import { FtcTable } from '@/components/grid/FtcTable';
import { CreateProjectForm } from '@/components/grid/CreateProjectForm';
import { ProjectDetailModal } from '@/components/grid/ProjectDetailModal';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
} from '@/components/ui/dialog';

const TABS = [
  {
    id: 'contd4',
    label: 'CONTD-4 Applications',
    description: 'Projects in the application & simulation phase',
  },
  {
    id: 'ftc',
    label: 'FTC / TOC / COD',
    description: 'Active commissioning phases across all projects',
  },
];

export function GenerationPageClient({
  projects,
  regions,
  plantTypes,
  poolingStations,
  stations = [],
  lockedRegionId,
  userRole,
  regionLabel,
}) {
  const [activeTab, setActiveTab] = useState('contd4');
  const [addOpen, setAddOpen]         = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const router = useRouter();

  const canCreate = ['ADMIN', 'NLDC', 'SRLDC', 'NRLDC', 'ERLDC', 'WRLDC', 'NERLDC'].includes(userRole);
  const canEdit   = canCreate;

  // Derive flat phase rows with parent project embedded — used by FtcTable
  const phases = useMemo(
    () => projects.flatMap((p) => p.phases.map((ph) => ({ ...ph, project: p }))),
    [projects]
  );

  function handleSuccess() {
    setAddOpen(false);
    router.refresh();
  }

  function handleViewProject(project) {
    setSelectedProject(project);
  }

  // When a phase row is clicked in the FTC tab, find and open the parent project
  function handleViewPhase(phase) {
    const project = projects.find((p) => p.id === phase.projectId);
    if (project) setSelectedProject(project);
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
            <h1 className="text-lg font-bold text-foreground leading-tight">Generation Tracker</h1>
            <p className="text-[12px] text-muted-foreground leading-tight">{regionLabel}</p>
          </div>
        </div>

        {canCreate && (
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4 mr-2" />
            Add Project
          </Button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 bg-muted/40 rounded-lg p-1 border border-border w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'px-4 py-1.5 rounded-md text-sm font-medium transition-all',
              activeTab === tab.id
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content — flex-grows to fill the viewport */}
      <div className="flex-1 min-h-0 flex flex-col">
        {activeTab === 'contd4' && (
          <GenerationTable
            projects={projects}
            userRole={userRole}
            onView={handleViewProject}
          />
        )}

        {activeTab === 'ftc' && (
          <FtcTable
            phases={phases}
            userRole={userRole}
            onView={handleViewPhase}
          />
        )}
      </div>

      {/* Add Project modal */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Generation Project</DialogTitle>
            <DialogDescription>
              Create a new generation project and optionally attach its CONTD-4 application.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <CreateProjectForm
              regions={regions}
              plantTypes={plantTypes}
              poolingStations={poolingStations}
              stations={stations}
              lockedRegionId={lockedRegionId}
              userRole={userRole}
              onSuccess={handleSuccess}
              onCancel={() => setAddOpen(false)}
            />
          </DialogBody>
        </DialogContent>
      </Dialog>

      {/* Project Detail modal — re-resolve from latest props so an in-modal
          router.refresh() updates the displayed data without remount. */}
      <ProjectDetailModal
        project={selectedProject ? (projects.find((p) => p.id === selectedProject.id) ?? selectedProject) : null}
        open={!!selectedProject}
        onOpenChange={(open) => { if (!open) setSelectedProject(null); }}
        canEdit={canEdit}
        userRole={userRole}
      />
    </div>
  );
}
