'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Contd4ApplicationTable } from '@/components/grid/Contd4ApplicationTable';
import { Contd4DetailModal } from '@/components/grid/Contd4DetailModal';
import { CreateProjectForm } from '@/components/grid/CreateProjectForm';
import { ExportButtons } from '@/components/grid/ExportButtons';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody,
} from '@/components/ui/dialog';

export function Contd4PageClient({
  projects,
  regions,
  plantTypes,
  poolingStations,
  stations = [],
  lockedRegionId,
  userRole,
  regionLabel,
  asOf,            // "YYYY-MM-DD" — if present, view is a past-date snapshot
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const router = useRouter();

  const canCreate = ['ADMIN', 'NLDC', 'SRLDC', 'NRLDC', 'ERLDC', 'WRLDC', 'NERLDC'].includes(userRole);
  const canEdit   = canCreate;

  return (
    <div className="px-6 pt-3 pb-3 space-y-2 flex flex-col h-[calc(100vh-150px)] min-h-0">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="size-8 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
            <FileText className="size-4 text-amber-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">
              Generation Capacity Under Process of CONTD-4
            </h1>
            <p className="text-[12px] text-muted-foreground leading-tight">{regionLabel}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canCreate && (
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="size-4 mr-2" />
              Add Project
            </Button>
          )}
          <ExportButtons asOf={asOf} size="sm" />
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <Contd4ApplicationTable
          projects={projects}
          userRole={userRole}
          onView={setSelected}
          asOf={asOf}
        />
      </div>

      {/* Add Project modal */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Add Generation Project</DialogTitle>
            <DialogDescription>
              Register a new generating station and optionally attach its CONTD-4 application.
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
              onSuccess={() => { setAddOpen(false); router.refresh(); }}
              onCancel={() => setAddOpen(false)}
            />
          </DialogBody>
        </DialogContent>
      </Dialog>

      {/* CONTD-4 detail modal.
          The modal's open state is keyed off the selected row's id, but the
          actual data displayed is re-resolved from the latest `projects`
          prop on every render. This means a router.refresh() inside the
          modal (e.g. after deleting a phase) flows the fresh data back
          into the open dialog without remount, so capacities / phases
          update instantly. */}
      <Contd4DetailModal
        project={selected ? (projects.find((p) => p.id === selected.id) ?? selected) : null}
        open={!!selected}
        onOpenChange={(o) => { if (!o) setSelected(null); }}
        canEdit={canEdit}
        userRole={userRole}
      />
    </div>
  );
}
