'use client';

// BESS Data edit modal — opened by clicking a row on the BESS Data page (same
// interaction as the FTC tracker's clickable rows). Only the two manually-
// maintained columns are editable: State (situated) and Energy Commissioned
// (MWh, now recorded phase-wise with an optional date per phase). Everything
// else (capacity, COD figures) is derived from the FTC pipeline and shown
// read-only for context.

import { useState, useEffect, useMemo, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Save, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody,
} from '@/components/ui/dialog';
import { updateBessRowFields } from '@/app/actions/grid';
import { fmt } from '@/components/grid/BessDataTab';
import { statesForRegion } from '@/lib/regions-states';

const toDateInput = (v) => (v ? String(v).slice(0, 10) : '');
const EMPTY_PHASE = { mwh: '', date: '', remarks: '' };

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
  const [phases, setPhases]       = useState([EMPTY_PHASE]);

  // Re-seed the form whenever a different row is opened. Seed from the stored
  // phase-wise data; fall back to the legacy single MWh value as one phase.
  useEffect(() => {
    if (!row) return;
    setStateName(row.stateName ?? '');
    const seed = Array.isArray(row.energyPhases) && row.energyPhases.length
      ? row.energyPhases.map((p) => ({
          mwh: p.mwh != null ? String(p.mwh) : '',
          date: toDateInput(p.date),
          remarks: p.remarks ?? '',
        }))
      : (row.energyMwh != null
          ? [{ mwh: String(row.energyMwh), date: '', remarks: '' }]
          : [{ ...EMPTY_PHASE }]);
    setPhases(seed);
  }, [row]);

  const stateOptions = useMemo(
    () => statesForRegion(row?.region).map((s) => ({ value: s, label: s })),
    [row?.region],
  );

  const total = phases.reduce((s, p) => s + (parseFloat(p.mwh) || 0), 0);

  const setPhase    = (i, key, val) => setPhases((prev) => prev.map((p, j) => (j === i ? { ...p, [key]: val } : p)));
  const addPhase    = () => setPhases((prev) => [...prev, { ...EMPTY_PHASE }]);
  const removePhase = (i) => setPhases((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : [{ ...EMPTY_PHASE }]));

  function handleSubmit(e) {
    e.preventDefault();
    if (!row) return;
    startTransition(async () => {
      const res = await updateBessRowFields(row.id, {
        stateName,
        energyPhases: phases
          .filter((p) => String(p.mwh).trim() !== '')
          .map((p) => ({ mwh: p.mwh, date: p.date || null, remarks: p.remarks || null })),
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
      <DialogContent className="max-w-2xl">
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

              {/* State */}
              <div className="flex flex-col gap-1 sm:max-w-xs">
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

              {/* Energy Commissioned — phase-wise, date optional */}
              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                    Energy Commissioned (MWh) — phase-wise
                  </label>
                  <span className="text-[11px] font-semibold text-foreground">
                    Total: <span className="tabular-nums">{fmt(total) || '0'}</span> MWh
                  </span>
                </div>

                <div className="grid grid-cols-[1fr_1fr_1.4fr_auto] gap-2 mb-1 px-0.5">
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">MWh *</span>
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Date (optional)</span>
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Remarks</span>
                  <span className="w-7" />
                </div>

                <div className="space-y-2">
                  {phases.map((p, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_1.4fr_auto] gap-2 items-center">
                      <input
                        type="number" step="0.01" min="0"
                        value={p.mwh}
                        onChange={(e) => setPhase(i, 'mwh', e.target.value)}
                        placeholder="0"
                        className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                      />
                      <DatePicker
                        value={p.date}
                        onChange={(v) => setPhase(i, 'date', v || '')}
                        placeholder="—"
                        className="h-9"
                      />
                      <input
                        type="text"
                        value={p.remarks}
                        onChange={(e) => setPhase(i, 'remarks', e.target.value)}
                        placeholder="e.g. Phase-1"
                        className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                      />
                      <button
                        type="button"
                        onClick={() => removePhase(i)}
                        title="Remove this phase"
                        className="size-7 flex items-center justify-center rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={addPhase}
                  className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded px-2 py-1 transition-colors"
                >
                  <Plus className="size-3" /> Add phase
                </button>
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
