'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Contd4ApplicationTable } from '@/components/grid/Contd4ApplicationTable';
import { Contd4DetailModal } from '@/components/grid/Contd4DetailModal';
import { CreateProjectForm } from '@/components/grid/CreateProjectForm';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody,
} from '@/components/ui/dialog';

export function Contd4PageClient({
  projects,
  regions,
  plantTypes,
  poolingStations,
  lockedRegionId,
  userRole,
  regionLabel,
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const router = useRouter();

  const canCreate = ['ADMIN', 'SRLDC', 'NRLDC', 'ERLDC', 'WRLDC', 'NERLDC'].includes(userRole);
  const canEdit   = canCreate;

  return (
    <div className="p-6 space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
            <FileText className="size-5 text-amber-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">
              Generation Capacity Under Process of CONTD-4
            </h1>
            <p className="text-sm text-muted-foreground">{regionLabel}</p>
          </div>
        </div>

        {canCreate && (
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4 mr-2" />
            Add Project
          </Button>
        )}
      </div>

      <Contd4ApplicationTable
        projects={projects}
        userRole={userRole}
        onView={setSelected}
      />

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
              lockedRegionId={lockedRegionId}
              userRole={userRole}
              onSuccess={() => { setAddOpen(false); router.refresh(); }}
              onCancel={() => setAddOpen(false)}
            />
          </DialogBody>
        </DialogContent>
      </Dialog>

      {/* CONTD-4 detail modal — no phases, pre-construction only */}
      <Contd4DetailModal
        project={selected}
        open={!!selected}
        onOpenChange={(o) => { if (!o) setSelected(null); }}
        canEdit={canEdit}
        userRole={userRole}
      />
    </div>
  );
}
