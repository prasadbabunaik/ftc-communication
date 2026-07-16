'use client';

// BESS Data edit modal — opened by clicking a row on the BESS Data page (same
// interaction as the FTC tracker's clickable rows).
//
// Inter-state rows: State (situated) + energy against each COD commissioning
// phase. The commissioning phases (MW + COD date) come from the FTC pipeline and
// are READ-ONLY here — only the MWh and Remarks per phase are editable. (If a
// row has no COD phases yet, it falls back to a free-form MWh editor.)
//
// Intra-state rows (state-network storage): additionally allow editing the
// Total Capacity (MW), and the phase-wise editor is fully editable — MW, MWh,
// Date and Remarks (MW first, then MWh). The phase MW drives the COD-declared
// capacity (Σ MW must not exceed Total Capacity); a phase with a blank date is
// reflected in the reference month by default.

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
import { fmt, fmtDate } from '@/components/grid/BessDataTab';
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

  const intra      = !!row?.isIntrastate;
  const codPhases  = Array.isArray(row?.codPhases) ? row.codPhases : [];
  // Intra-state (pure OR hybrid) is user-maintained: MW is editable (optional —
  // MWh may be entered without MW). Inter-state COD is pipeline-derived, so it
  // shows MW + date read-only with only MWh + remarks editable.
  const mwEditable  = intra;
  const codReadOnly = !intra && codPhases.length > 0;
  const showMw      = mwEditable || codReadOnly;
  const addable     = mwEditable || (!mwEditable && !codReadOnly);

  const [stateName, setStateName]    = useState('');
  const [totalCapacity, setTotalCap] = useState('');
  const [phases, setPhases]          = useState([{ ...EMPTY_PHASE }]);

  // Re-seed the form whenever a different row is opened.
  useEffect(() => {
    if (!row) return;
    setStateName(row.stateName ?? '');
    setTotalCap(row.totalCapacityMw != null ? String(row.totalCapacityMw) : '');

    if (codReadOnly) {
      // Inter-state: the COD phases (MW + date) are pipeline-derived and the MWh +
      // remarks now live on the COD events themselves — the FTC-tracker source of
      // truth. Seed straight from them; each phase keeps its COD-event id so the
      // save writes MWh back to that event.
      const seed = codPhases.map((cp) => ({
        id: cp.id ?? null,
        mw: cp.mw != null ? String(cp.mw) : '',
        date: toDateInput(cp.date),
        mwh: cp.mwh != null && Number(cp.mwh) > 0 ? String(cp.mwh) : '',
        remarks: cp.remarks ?? '',
      }));
      setPhases(seed.length ? seed : [{ ...EMPTY_PHASE }]);
    } else {
      const stored = Array.isArray(row.energyPhases) ? row.energyPhases : [];
      const hasStoredMw = stored.some((p) => p.mw != null && String(p.mw).trim() !== '');
      if (mwEditable && !hasStoredMw && codPhases.length) {
        // Intra-state with a pipeline COD but no user-entered MW yet: pre-fill the
        // EDITABLE MW (+ date) from the COD phases so the current COD (e.g. 40)
        // shows and can be adjusted; merge any stored MWh in by COD date.
        const energyList = [...stored];
        const takeByDate = (d) => {
          const i = energyList.findIndex((e) => toDateInput(e.date) === toDateInput(d));
          return i >= 0 ? energyList.splice(i, 1)[0] : null;
        };
        const seed = codPhases.map((cp) => {
          const e = takeByDate(cp.date);
          return {
            mw: cp.mw != null ? String(cp.mw) : '',
            date: toDateInput(cp.date),
            mwh: e?.mwh != null ? String(e.mwh) : '',
            remarks: e?.remarks ?? '',
          };
        });
        const leftover = energyList.reduce((s, e) => s + (Number(e.mwh) || 0), 0);
        if (leftover > 0 && seed.length && !seed[0].mwh) seed[0].mwh = String(leftover);
        setPhases(seed.length ? seed : [{ ...EMPTY_PHASE }]);
      } else {
        const seed = stored.length
          ? stored.map((p) => ({
              mw: p.mw != null ? String(p.mw) : '',
              mwh: p.mwh != null ? String(p.mwh) : '',
              date: toDateInput(p.date),
              remarks: p.remarks ?? '',
            }))
          : (row.energyMwh != null
              ? [{ mw: '', mwh: String(row.energyMwh), date: '', remarks: '' }]
              : [{ ...EMPTY_PHASE }]);
        setPhases(seed);
      }
    }
  }, [row]); // eslint-disable-line react-hooks/exhaustive-deps

  const stateOptions = useMemo(
    () => statesForRegion(row?.region).map((s) => ({ value: s, label: s })),
    [row?.region],
  );

  const totalMw  = phases.reduce((s, p) => s + (parseFloat(p.mw) || 0), 0);
  const totalMwh = phases.reduce((s, p) => s + (parseFloat(p.mwh) || 0), 0);

  // Pure intra-state: every phase with a value must carry a COD date. MWh may be
  // entered without MW, but the date is mandatory (it links the phase to its
  // month). Blocks the save until every valued phase has a date.
  const undatedCount = mwEditable
    ? phases.filter((p) => (String(p.mw).trim() !== '' || String(p.mwh).trim() !== '') && !String(p.date).trim()).length
    : 0;

  // Intra-state: COD-declared capacity (Σ phase MW) must not exceed Total Capacity.
  const capNum      = parseFloat(totalCapacity);
  const capExceeded = mwEditable && !isNaN(capNum) && totalMw > capNum + 1e-6;

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
    if (undatedCount > 0) {
      toast.error('Each phase must have a COD date before saving.');
      return;
    }
    startTransition(async () => {
      const payload = { stateName };
      if (codReadOnly) {
        // Inter-state: write the MWh + remarks straight back to the COD events
        // (the FTC-tracker source). MW / date stay pipeline-derived and untouched.
        payload.codEventEnergy = phases
          .filter((p) => p.id)
          .map((p) => ({
            id: p.id,
            mwh: String(p.mwh).trim() !== '' ? p.mwh : null,
            remarks: p.remarks || null,
          }));
      } else {
        // Intra-state (pure): MW + MWh + date maintained here as energy phases.
        payload.energyPhases = phases
          .filter((p) => String(p.mw).trim() !== '' || String(p.mwh).trim() !== '')
          .map((p) => ({
            mw: mwEditable && String(p.mw).trim() !== '' ? p.mw : null,
            mwh: String(p.mwh).trim() !== '' ? p.mwh : null,
            date: p.date || null,
            remarks: p.remarks || null,
          }));
        if (intra) payload.totalCapacityMw = totalCapacity;
      }

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

  // Phase-editor column layout. A MW column leads when it's shown (intra edit or
  // inter-state read-only COD). minmax(0,…) keeps cells aligned & non-overflowing.
  const gridCols = showMw
    ? 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1.5fr)_28px]'
    : 'grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1.5fr)_28px]';

  const roCell = 'h-9 flex items-center px-3 text-sm text-slate-600 tabular-nums rounded-md border border-dashed border-border bg-slate-50/60 min-w-0';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit BESS Data{intra ? ' — Intra-state' : ''}</DialogTitle>
          <DialogDescription>
            {mwEditable
              ? 'Intra-state storage: edit the Total Capacity and record COD capacity (MW) & energy (MWh) phase-wise. Each phase needs a COD date.'
              : codReadOnly
                ? `COD commissioning phases (MW + date) are derived from the FTC pipeline and read-only. Edit ${intra ? 'the Total Capacity, ' : ''}the Energy Commissioned (MWh) and Remarks against each phase.`
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

              {/* Phase-wise editor */}
              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                    {mwEditable
                      ? 'Capacity & Energy — phase-wise'
                      : codReadOnly
                        ? 'Energy Commissioned (MWh) — per COD phase'
                        : 'Energy Commissioned (MWh) — phase-wise'}
                  </label>
                  <span className="text-[11px] font-semibold text-foreground">
                    {showMw && <>{mwEditable ? 'Total: ' : 'COD: '}<span className={`tabular-nums ${capExceeded ? 'text-rose-600' : ''}`}>{fmt(totalMw) || '0'}</span> MW&nbsp;·&nbsp;</>}
                    <span className="tabular-nums">{fmt(totalMwh) || '0'}</span> MWh
                  </span>
                </div>

                <div className={`grid ${gridCols} gap-2 mb-1 px-0.5`}>
                  {showMw && <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">MW{codReadOnly ? ' (COD)' : ''}</span>}
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">MWh</span>
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{codReadOnly ? 'COD Date' : 'Date'}</span>
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Remarks</span>
                  <span className="w-7" />
                </div>

                <div className="space-y-2">
                  {phases.map((p, i) => {
                    const dateMissing = mwEditable && (String(p.mw).trim() !== '' || String(p.mwh).trim() !== '') && !String(p.date).trim();
                    return (
                    <div key={i} className={`grid ${gridCols} gap-2 items-center`}>
                      {/* MW — editable (pure intra) or read-only COD (hybrid / inter) */}
                      {showMw && (
                        mwEditable ? (
                          <input
                            type="number" step="0.01" min="0"
                            value={p.mw}
                            onChange={(e) => setPhase(i, 'mw', e.target.value)}
                            placeholder="0"
                            className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                          />
                        ) : (
                          <div className={roCell} title="COD capacity (from pipeline)">{fmt(p.mw) || '—'}</div>
                        )
                      )}

                      {/* MWh — always editable */}
                      <input
                        type="number" step="0.01" min="0"
                        value={p.mwh}
                        onChange={(e) => setPhase(i, 'mwh', e.target.value)}
                        placeholder="0"
                        className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                      />

                      {/* Date — read-only COD date (hybrid / inter) or required entry (pure intra) */}
                      {codReadOnly ? (
                        <div className={`${roCell} justify-start`} title="COD date (from pipeline)">{fmtDate(p.date) || '—'}</div>
                      ) : (
                        <DatePicker
                          value={p.date}
                          onChange={(v) => setPhase(i, 'date', v || '')}
                          placeholder="Required"
                          className={`h-9 w-full min-w-0 ${dateMissing ? 'border-rose-400 ring-1 ring-rose-300 rounded-md' : ''}`}
                        />
                      )}

                      {/* Remarks — always editable */}
                      <input
                        type="text"
                        value={p.remarks}
                        onChange={(e) => setPhase(i, 'remarks', e.target.value)}
                        placeholder="e.g. Phase-1"
                        className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                      />

                      {/* Remove — only when rows are user-managed */}
                      {addable ? (
                        <button
                          type="button"
                          onClick={() => removePhase(i)}
                          title="Remove this phase"
                          className="size-7 flex items-center justify-center rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      ) : (
                        <span className="w-7" />
                      )}
                    </div>
                    );
                  })}
                </div>

                {addable && (
                  <button
                    type="button"
                    onClick={addPhase}
                    className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded px-2 py-1 transition-colors"
                  >
                    <Plus className="size-3" /> Add phase
                  </button>
                )}

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

                {undatedCount > 0 && (
                  <p className="mt-2 flex items-start gap-1.5 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">
                    <AlertTriangle className="size-3.5 shrink-0 mt-px" />
                    <span>
                      {undatedCount} phase{undatedCount === 1 ? '' : 's'} {undatedCount === 1 ? 'is' : 'are'} missing a COD date.
                      A date is required for every phase (MWh may be entered without MW). Add the date to save.
                    </span>
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={isPending}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isPending || capExceeded || undatedCount > 0}>
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
