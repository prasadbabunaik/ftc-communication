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

  const canCreate = ['ADMIN', 'SRLDC', 'NRLDC', 'ERLDC', 'WRLDC', 'NERLDC'].includes(userRole);

  return (
    <div className="p-6 space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-lg bg-purple-50 flex items-center justify-center">
            <Cable className="size-5 text-purple-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Transmission Elements</h1>
            <p className="text-sm text-muted-foreground">Lines, ICTs, and transformers under FTC process</p>
          </div>
        </div>
        {canCreate && (
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4 mr-2" />
            Add Element
          </Button>
        )}
      </div>

      <TransmissionTable elements={elements} userRole={userRole} onView={setViewElement} />

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
      />
    </div>
  );
}
