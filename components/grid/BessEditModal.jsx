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
  // Inter-state row that has COD phases → phase rows are pipeline-driven, with
  // MW + date locked and only MWh + remarks editable, no add/remove.
  const interLocked = !intra && codPhases.length > 0;
  const showMw      = intra || interLocked;
  const addable     = intra || (!intra && !interLocked);

  const [stateName, setStateName]    = useState('');
  const [totalCapacity, setTotalCap] = useState('');
  const [phases, setPhases]          = useState([{ ...EMPTY_PHASE }]);

  // Re-seed the form whenever a different row is opened.
  useEffect(() => {
    if (!row) return;
    setStateName(row.stateName ?? '');
    setTotalCap(row.totalCapacityMw != null ? String(row.totalCapacityMw) : '');

    if (interLocked) {
      // Rows are the pipeline COD phases; MWh + remarks come from stored energy
      // phases matched by COD date (positional fallback so nothing is lost).
      const energyList = Array.isArray(row.energyPhases) ? [...row.energyPhases] : [];
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
      // Any unmatched legacy MWh (e.g. a single undated entry) → first phase, so
      // switching to phase-aligned energy never drops the recorded total.
      const leftover = energyList.reduce((s, e) => s + (Number(e.mwh) || 0), 0);
      if (leftover > 0 && seed.length && !seed[0].mwh) seed[0].mwh = String(leftover);
      setPhases(seed.length ? seed : [{ ...EMPTY_PHASE }]);
    } else {
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
    }
  }, [row]); // eslint-disable-line react-hooks/exhaustive-deps

  const stateOptions = useMemo(
    () => statesForRegion(row?.region).map((s) => ({ value: s, label: s })),
    [row?.region],
  );

  const totalMw  = phases.reduce((s, p) => s + (parseFloat(p.mw) || 0), 0);
  const totalMwh = phases.reduce((s, p) => s + (parseFloat(p.mwh) || 0), 0);

  // Intra-state: commissioning phases with a value but no COD date. Allowed
  // (saved as-is), but surfaced so the date is filled in next time.
  const undatedCount = phases.filter(
    (p) => (String(p.mw).trim() !== '' || String(p.mwh).trim() !== '') && !String(p.date).trim(),
  ).length;

  // Intra-state: COD-declared capacity (Σ phase MW) must not exceed Total Capacity.
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
        // MW is persisted only for intra-state (inter-state COD MW is pipeline-
        // derived and read-only). Inter-state stores its date so re-seeding can
        // match each MWh back to its COD phase.
        energyPhases: phases
          .filter((p) => String(p.mw).trim() !== '' || String(p.mwh).trim() !== '')
          .map((p) => ({
            mw: intra && String(p.mw).trim() !== '' ? p.mw : null,
            mwh: String(p.mwh).trim() !== '' ? p.mwh : null,
            date: p.date || null,
            remarks: p.remarks || null,
          })),
      };
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
            {intra
              ? 'Intra-state storage: edit the Total Capacity and record COD capacity (MW) & energy (MWh) phase-wise. A phase with no date is reflected in the current reference month.'
              : interLocked
                ? 'COD commissioning phases (MW + date) are derived from the FTC pipeline and read-only. Edit only the Energy Commissioned (MWh) and Remarks against each phase.'
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
                    {intra
                      ? 'Capacity & Energy — phase-wise'
                      : interLocked
                        ? 'Energy Commissioned (MWh) — per COD phase'
                        : 'Energy Commissioned (MWh) — phase-wise'}
                  </label>
                  <span className="text-[11px] font-semibold text-foreground">
                    {showMw && <>{intra ? 'Total: ' : 'COD: '}<span className={`tabular-nums ${capExceeded ? 'text-rose-600' : ''}`}>{fmt(totalMw) || '0'}</span> MW&nbsp;·&nbsp;</>}
                    <span className="tabular-nums">{fmt(totalMwh) || '0'}</span> MWh
                  </span>
                </div>

                <div className={`grid ${gridCols} gap-2 mb-1 px-0.5`}>
                  {showMw && <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">MW{interLocked ? ' (COD)' : ''}</span>}
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">MWh</span>
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{interLocked ? 'COD Date' : 'Date (optional)'}</span>
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Remarks</span>
                  <span className="w-7" />
                </div>

                <div className="space-y-2">
                  {phases.map((p, i) => (
                    <div key={i} className={`grid ${gridCols} gap-2 items-center`}>
                      {/* MW — editable (intra) or read-only COD (inter) */}
                      {showMw && (
                        intra ? (
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

                      {/* Date — editable (intra / free-form) or read-only COD date (inter) */}
                      {interLocked ? (
                        <div className={`${roCell} justify-start`} title="COD date (from pipeline)">{fmtDate(p.date) || '—'}</div>
                      ) : (
                        <DatePicker
                          value={p.date}
                          onChange={(v) => setPhase(i, 'date', v || '')}
                          placeholder="—"
                          className="h-9 w-full min-w-0"
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
                  ))}
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
