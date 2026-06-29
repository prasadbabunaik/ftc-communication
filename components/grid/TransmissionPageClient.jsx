'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Cable } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TransmissionTable } from '@/components/grid/TransmissionTable';
import { TransmissionDetailModal } from '@/components/grid/TransmissionDetailModal';
import { AddTransmissionForm } from '@/components/grid/AddTransmissionForm';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody,
} from '@/components/ui/dialog';

export function TransmissionPageClient({ elements, regions, lockedRegionId, userRole }) {
  const [addOpen, setAddOpen]         = useState(false);
  const [viewElement, setViewElement] = useState(null);
  const router = useRouter();

  const canCreate = ['ADMIN', 'NLDC', 'SRLDC', 'NRLDC', 'ERLDC', 'WRLDC', 'NERLDC'].includes(userRole);

  return (
    <div className="px-6 pt-3 pb-3 space-y-2 flex flex-col h-[calc(100vh-150px)] min-h-0">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="size-8 rounded-lg bg-purple-50 flex items-center justify-center">
            <Cable className="size-4 text-purple-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">Transmission Elements</h1>
            <p className="text-[12px] text-muted-foreground leading-tight">Lines, ICTs, and transformers under FTC process</p>
          </div>
        </div>
        {canCreate && (
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4 mr-2" />
            Add Element
          </Button>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <TransmissionTable elements={elements} userRole={userRole} onView={setViewElement} />
      </div>

      {/* Add Element modal */}
      <Dialog open={addOpen} onOpenChange={(o) => { if (!o) setAddOpen(false); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Add Transmission Element</DialogTitle>
            <DialogDescription>
              Add a transmission line, ICT, or transformer under the FTC process.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <AddTransmissionForm
              regions={regions}
              lockedRegionId={lockedRegionId}
              userRole={userRole}
              onSuccess={() => { setAddOpen(false); router.refresh(); }}
              onCancel={() => setAddOpen(false)}
            />
          </DialogBody>
        </DialogContent>
      </Dialog>

      {/* Element detail / edit modal */}
      <TransmissionDetailModal
        element={viewElement}
        open={!!viewElement}
        onOpenChange={(o) => { if (!o) setViewElement(null); }}
        canEdit={canCreate}
        regions={regions}
        userRole={userRole}
      />
    </div>
  );
}
