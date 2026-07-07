'use client';

// BESS Data edit modal — opened by clicking a row on the BESS Data page (same
// interaction as the FTC tracker's clickable rows).
//
// Inter-state rows: only State (situated) and Energy Commissioned (MWh,
// phase-wise) are editable; capacity / COD come from the FTC pipeline and are
// read-only for context.
//
// Intra-state rows (state-network storage): additionally allow editing the
// Total Capacity (MW), and the phase-wise editor carries BOTH MW and MWh per
// phase (MW first, then MWh). The phase MW drives the COD-declared capacity —
// a phase with a blank date is reflected in the reference month by default.

import { useState, useEffect, useMemo, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Save, Plus, Trash2, AlertTriangle } from 'lucide-react';
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
const EMPTY_PHASE = { mw: '', mwh: '', date: '', remarks: '' };

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
  const intra = !!row?.isIntrastate;

  const [stateName, setStateName]     = useState('');
  const [totalCapacity, setTotalCap]  = useState('');
  const [phases, setPhases]           = useState([{ ...EMPTY_PHASE }]);

  // Re-seed the form whenever a different row is opened. Seed phases from the
  // stored phase-wise data; fall back to the legacy single MWh value as one
  // phase (its MW blank).
  useEffect(() => {
    if (!row) return;
    setStateName(row.stateName ?? '');
    setTotalCap(row.totalCapacityMw != null ? String(row.totalCapacityMw) : '');
    const seed = Array.isArray(row.energyPhases) && row.energyPhases.length
      ? row.energyPhases.map((p) => ({
          mw: p.mw != null ? String(p.mw) : '',
          mwh: p.mwh != null ? String(p.mwh) : '',
          date: toDateInput(p.date),
          remarks: p.remarks ?? '',
        }))
      : (row.energyMwh != null
          ? [{ mw: '', mwh: String(row.energyMwh), date: '', remarks: '' }]
          : [{ ...EMPTY_PHASE }]);
    setPhases(seed);
  }, [row]);

  const stateOptions = useMemo(
    () => statesForRegion(row?.region).map((s) => ({ value: s, label: s })),
    [row?.region],
  );

  const totalMw  = phases.reduce((s, p) => s + (parseFloat(p.mw) || 0), 0);
  const totalMwh = phases.reduce((s, p) => s + (parseFloat(p.mwh) || 0), 0);

  // Commissioning phases with a value but no COD date. Allowed (saved as-is),
  // but surfaced as a validation notice so the date is filled in next time —
  // a dated phase attributes to the right "COD Declared in <Month>" column,
  // whereas an undated one is only reflected in the current reference month.
  const undatedCount = phases.filter(
    (p) => (String(p.mw).trim() !== '' || String(p.mwh).trim() !== '') && !String(p.date).trim(),
  ).length;

  // Intra-state COD-declared capacity (Σ phase MW) must not exceed the plant's
  // Total Capacity (MW). Blocks the save until corrected.
  const capNum      = parseFloat(totalCapacity);
  const capExceeded = intra && !isNaN(capNum) && totalMw > capNum + 1e-6;

  const setPhase    = (i, key, val) => setPhases((prev) => prev.map((p, j) => (j === i ? { ...p, [key]: val } : p)));
  const addPhase    = () => setPhases((prev) => [...prev, { ...EMPTY_PHASE }]);
  const removePhase = (i) => setPhases((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : [{ ...EMPTY_PHASE }]));

  function handleSubmit(e) {
    e.preventDefault();
    if (!row) return;
    if (capExceeded) {
      toast.error(`COD-declared capacity (${fmt(totalMw)} MW) cannot exceed Total Capacity (${fmt(capNum)} MW).`);
      return;
    }
    startTransition(async () => {
      const payload = {
        stateName,
        energyPhases: phases
          .filter((p) => String(p.mw).trim() !== '' || String(p.mwh).trim() !== '')
          .map((p) => ({
            mw: intra && String(p.mw).trim() !== '' ? p.mw : null,
            mwh: String(p.mwh).trim() !== '' ? p.mwh : null,
            date: p.date || null,
            remarks: p.remarks || null,
          })),
      };
      // Total Capacity is only editable for intra-state rows.
      if (intra) payload.totalCapacityMw = totalCapacity;

      const res = await updateBessRowFields(row.id, payload);
      if (res?.error) {
        toast.error(typeof res.error === 'string' ? res.error : 'Update failed.');
      } else {
        toast.success('BESS row updated.');
        onOpenChange(false);
        router.refresh();
      }
    });
  }

  // Phase-editor column layout — intra-state adds a leading MW column. Tracks
  // use minmax(0,…) so the cells shrink to fit the modal (no horizontal
  // overflow) and the header row stays aligned with the input row.
  const gridCols = intra
    ? 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1.5fr)_28px]'
    : 'grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1.5fr)_28px]';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit BESS Data{intra ? ' — Intra-state' : ''}</DialogTitle>
          <DialogDescription>
            {intra
              ? 'Intra-state storage: edit the Total Capacity and record COD capacity (MW) & energy (MWh) phase-wise. A phase with no date is reflected in the current reference month.'
              : 'Only the manually-maintained fields are editable. Capacity and COD figures are derived from the FTC pipeline / CONTD-4 and shown for reference.'}
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
                {!intra && (
                  <ReadOnlyRow label="Total Capacity (MW)" value={fmt(row.totalCapacityMw) || '—'} />
                )}
                <ReadOnlyRow label="COD Declared Capacity (MW)" value={fmt(row.codDeclared) || '—'} />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {/* State */}
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

                {/* Total Capacity (MW) — editable for intra-state only */}
                {intra && (
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Total Capacity (MW)</label>
                    <input
                      type="number" step="0.01" min="0"
                      value={totalCapacity}
                      onChange={(e) => setTotalCap(e.target.value)}
                      placeholder="0"
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                    />
                  </div>
                )}
              </div>

              {/* Phase-wise capacity (MW) + energy (MWh), date optional */}
              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                    {intra ? 'Capacity & Energy — phase-wise' : 'Energy Commissioned (MWh) — phase-wise'}
                  </label>
                  <span className="text-[11px] font-semibold text-foreground">
                    {intra && <>Total: <span className={`tabular-nums ${capExceeded ? 'text-rose-600' : ''}`}>{fmt(totalMw) || '0'}</span> MW&nbsp;·&nbsp;</>}
                    <span className="tabular-nums">{fmt(totalMwh) || '0'}</span> MWh
                  </span>
                </div>

                <div className={`grid ${gridCols} gap-2 mb-1 px-0.5`}>
                  {intra && <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">MW</span>}
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">MWh</span>
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Date (optional)</span>
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Remarks</span>
                  <span className="w-7" />
                </div>

                <div className="space-y-2">
                  {phases.map((p, i) => (
                    <div key={i} className={`grid ${gridCols} gap-2 items-center`}>
                      {intra && (
                        <input
                          type="number" step="0.01" min="0"
                          value={p.mw}
                          onChange={(e) => setPhase(i, 'mw', e.target.value)}
                          placeholder="0"
                          className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                        />
                      )}
                      <input
                        type="number" step="0.01" min="0"
                        value={p.mwh}
                        onChange={(e) => setPhase(i, 'mwh', e.target.value)}
                        placeholder="0"
                        className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                      />
                      <DatePicker
                        value={p.date}
                        onChange={(v) => setPhase(i, 'date', v || '')}
                        placeholder="—"
                        className="h-9 w-full min-w-0"
                      />
                      <input
                        type="text"
                        value={p.remarks}
                        onChange={(e) => setPhase(i, 'remarks', e.target.value)}
                        placeholder="e.g. Phase-1"
                        className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
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

                {capExceeded && (
                  <p className="mt-2 flex items-start gap-1.5 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">
                    <AlertTriangle className="size-3.5 shrink-0 mt-px" />
                    <span>
                      COD-declared capacity (<span className="font-semibold tabular-nums">{fmt(totalMw)}</span> MW) exceeds
                      Total Capacity (<span className="font-semibold tabular-nums">{fmt(capNum)}</span> MW).
                      Reduce the phase MW or raise the Total Capacity before saving.
                    </span>
                  </p>
                )}

                {intra && undatedCount > 0 && (
                  <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                    <AlertTriangle className="size-3.5 shrink-0 mt-px" />
                    <span>
                      {undatedCount} commissioning phase{undatedCount === 1 ? ' has' : 's have'} no COD date.
                      You can save now — {undatedCount === 1 ? 'it is' : 'they are'} counted in the current
                      month&apos;s “COD Declared in &lt;Month&gt;” column — but add the date so it links to the
                      correct month.
                    </span>
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={isPending}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isPending || capExceeded}>
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
