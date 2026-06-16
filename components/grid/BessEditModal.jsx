'use client';

// BESS Data edit modal — opened by clicking a row on the BESS Data page (same
// interaction as the FTC tracker's clickable rows). Only the two manually-
// maintained columns are editable: State (situated) and Energy Commissioned
// (MWh). Everything else (capacity, COD figures) is derived from the FTC
// pipeline and shown read-only for context.

import { useState, useEffect, useMemo, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody,
} from '@/components/ui/dialog';
import { updateBessRowFields } from '@/app/actions/grid';
import { fmt } from '@/components/grid/BessDataTab';
import { statesForRegion } from '@/lib/regions-states';

function ReadOnlyRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground text-right">{value}</span>
    </div>
  );
}

export function BessEditModal({ row, open, onOpenChange }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [stateName, setStateName] = useState('');
  const [energy, setEnergy]       = useState('');

  // Re-seed the form whenever a different row is opened.
  useEffect(() => {
    if (!row) return;
    setStateName(row.stateName ?? '');
    setEnergy(row.energyMwh != null ? String(row.energyMwh) : '');
  }, [row]);

  // State options scoped to this project's region (NR/WR/SR/ER/NER); the value
  // and label are the state name itself.
  const stateOptions = useMemo(
    () => statesForRegion(row?.region).map((s) => ({ value: s, label: s })),
    [row?.region],
  );

  function handleSubmit(e) {
    e.preventDefault();
    if (!row) return;
    startTransition(async () => {
      const res = await updateBessRowFields(row.id, {
        stateName,
        energyCommissionedMwh: energy,
      });
      if (res?.error) {
        toast.error(typeof res.error === 'string' ? res.error : 'Update failed.');
      } else {
        toast.success('BESS row updated.');
        onOpenChange(false);
        router.refresh();
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit BESS Data</DialogTitle>
          <DialogDescription>
            Only the manually-maintained fields are editable. Capacity and COD
            figures are derived from the FTC pipeline / CONTD-4 and shown for reference.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {row && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Read-only context pulled from the pipeline */}
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 space-y-1.5">
                <ReadOnlyRow label="Generating Station" value={row.name} />
                <ReadOnlyRow label="Region" value={row.region} />
                <ReadOnlyRow label="Plant Type" value={row.plantType} />
                <ReadOnlyRow label="Total Capacity (MW)" value={fmt(row.totalCapacityMw) || '—'} />
                <ReadOnlyRow label="COD Declared Capacity (MW)" value={fmt(row.codDeclared) || '—'} />
              </div>

              {/* Editable, non-pipeline fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">State (situated)</label>
                  <Combobox
                    options={stateOptions}
                    value={stateName}
                    onChange={setStateName}
                    placeholder="— Select state —"
                    searchPlaceholder={`Search ${row.region !== '—' ? row.region + ' ' : ''}states…`}
                    emptyText="No matching state."
                    creatable
                    onCreate={setStateName}
                    className="h-9"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Energy Commissioned (MWh)</label>
                  <input
                    type="number" step="0.01" min="0"
                    value={energy}
                    onChange={(e) => setEnergy(e.target.value)}
                    placeholder="—"
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={isPending}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isPending}>
                  <Save className="size-3.5 mr-1.5" />
                  {isPending ? 'Saving…' : 'Save Changes'}
                </Button>
              </div>
            </form>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
