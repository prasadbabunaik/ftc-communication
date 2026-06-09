'use client';

import { useState, useTransition, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createPhasesSchema } from '@/lib/validations/grid';
import { upsertProjectPhases, updateProjectCapacities } from '@/app/actions/grid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import { Alert, AlertIcon, AlertTitle } from '@/components/ui/alert';
import { GovLoader } from '@/components/ui/gov-loader';
import { AlertCircle, Plus, Trash2, Lock, Pencil, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useSettings } from '@/providers/settings-provider';

function fmtRefMonth(ym) {
  if (!ym) return 'Expected';
  try {
    const d = new Date(`${ym}-01`);
    const month = d.toLocaleString('en-US', { month: 'short' });
    const year  = String(d.getFullYear()).slice(2);
    return `Exp. ${month}'${year} (MW)`;
  } catch { return "Expected (MW)"; }
}

const SOURCE_TYPES = ['WIND', 'SOLAR', 'COAL', 'HYDRO', 'PSP', 'BESS'];

// Mirrors EDIT_ROLES in lib/server-auth.js — drives whether the capacity
// fields render as editable inputs. The server action re-checks this; the
// client gate just hides the inputs from read-only viewers.
const EDIT_ROLES_CLIENT = ['ADMIN', 'SRLDC', 'NRLDC', 'ERLDC', 'WRLDC', 'NERLDC'];

// Derive valid source types from the plant type label
function getPlantSources(plantType) {
  const label = plantType.label;
  if (!plantType.isHybrid) {
    if (label.startsWith('Solar'))   return ['SOLAR'];
    if (label.startsWith('Wind'))    return ['WIND'];
    if (label.startsWith('Coal'))    return ['COAL'];
    if (label.startsWith('Hydro'))   return ['HYDRO'];
    if (label.startsWith('Battery') || label.includes('BESS')) return ['BESS'];
    if (label.startsWith('Pumped')  || label.includes('PSP'))  return ['PSP'];
    return ['SOLAR'];
  }
  // Hybrid: parse components from label (e.g. "Hybrid (Wind+Solar+BESS)")
  const sources = [];
  if (label.includes('Wind'))  sources.push('WIND');
  if (label.includes('Solar')) sources.push('SOLAR');
  if (label.includes('BESS'))  sources.push('BESS');
  if (label.includes('Hydro')) sources.push('HYDRO');
  if (label.includes('PSP'))   sources.push('PSP');
  return sources.length > 0 ? sources : ['SOLAR'];
}

const SOURCE_COLORS = {
  WIND:  'bg-sky-100 text-sky-800 border-sky-200',
  SOLAR: 'bg-amber-100 text-amber-800 border-amber-200',
  BESS:  'bg-violet-100 text-violet-800 border-violet-200',
  COAL:  'bg-stone-100 text-stone-700 border-stone-200',
  HYDRO: 'bg-teal-100 text-teal-800 border-teal-200',
  PSP:   'bg-emerald-100 text-emerald-800 border-emerald-200',
};

const EMPTY_EVENT = { mw: '', date: '', remarks: '' };

const EMPTY_PHASE = {
  existingId:         null,
  sourceType:         'SOLAR',
  capacityAppliedMw:  '',
  proposedFtcDate:    '',
  capacityUnderFtcMw: '',
  capacityUnderTocMw: '',
  expectedApr26Mw:    '',
  expectedMonth:      '',
  delayRemarks:       '',
  otherRemarks:       '',
  ftcEvents:          [],
  tocEvents:          [],
  codEvents:          [],
};

// Month options for the "Expected (MW)" dropdown — 12 past + 24 future from
// today. Past months matter when ADMIN/NLDC back-fills historical data.
function buildMonthOptions() {
  const options = [];
  const now = new Date();
  for (let i = -12; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const month = d.toLocaleString('en-US', { month: 'short' });
    const year  = String(d.getFullYear()).slice(2);
    options.push({ value, label: `${month}'${year}` });
  }
  return options;
}
const MONTH_OPTIONS = buildMonthOptions();
function fmtMonthShort(ym) {
  if (!ym) return '';
  const opt = MONTH_OPTIONS.find((o) => o.value === ym);
  return opt?.label ?? ym;
}

function sumEvents(evs) {
  // Form events use `mw`; DB-serialised events (from enriched phases) use `capacityMw`
  return (evs ?? []).reduce((s, e) => s + (parseFloat(e.mw ?? e.capacityMw) || 0), 0);
}

// Convert a DB-shape phase to the form's string-everywhere shape. Used
// when the modal is opened for a project that already has phases — the
// form pre-fills with the current state and the save handler routes to
// an upsert action (existingId carries the phase identity so saving
// modifies the existing row instead of creating a duplicate).
function existingPhaseToFormRow(ph, defaultMonth) {
  const ev = (e) => ({
    id: e.id,
    mw: e.capacityMw != null ? String(Number(e.capacityMw)) : '',
    date: e.eventDate ? new Date(e.eventDate).toISOString().slice(0, 10) : '',
    remarks: e.remarks ?? '',
  });
  return {
    // Hidden marker — distinguishes "edit this existing phase" from "add a
    // new one". Server action upsertProjectPhases reads it.
    existingId:         ph.id ?? null,
    sourceType:         ph.sourceType,
    capacityAppliedMw:  ph.capacityAppliedMw  != null ? String(Number(ph.capacityAppliedMw))  : '',
    proposedFtcDate:    ph.proposedFtcDate    ? new Date(ph.proposedFtcDate).toISOString().slice(0, 10) : '',
    capacityUnderFtcMw: ph.capacityUnderFtcMw != null ? String(Number(ph.capacityUnderFtcMw)) : '',
    capacityUnderTocMw: ph.capacityUnderTocMw != null ? String(Number(ph.capacityUnderTocMw)) : '',
    expectedApr26Mw:    ph.expectedApr26Mw    != null ? String(Number(ph.expectedApr26Mw))    : '',
    expectedMonth:      ph.expectedMonth ?? defaultMonth,
    delayRemarks:       ph.delayRemarks ?? '',
    otherRemarks:       ph.otherRemarks ?? '',
    ftcEvents:          (ph.ftcEvents ?? []).map(ev),
    tocEvents:          (ph.tocEvents ?? []).map(ev),
    codEvents:          (ph.codEvents ?? []).map(ev),
  };
}

function computePipeline(phases) {
  const map = {};
  for (const ph of (phases ?? [])) {
    const s = ph.sourceType;
    if (!map[s]) map[s] = { applied: 0, ftc: 0, toc: 0, cod: 0 };
    map[s].applied += Number(ph.capacityAppliedMw ?? 0);
    // Support both old summary fields (existingPhases) and new event arrays (form)
    map[s].ftc += ph.ftcEvents != null ? sumEvents(ph.ftcEvents) : Number(ph.ftcCompletedMw ?? 0);
    map[s].toc += ph.tocEvents != null ? sumEvents(ph.tocEvents) : Number(ph.tocIssuedMw    ?? 0);
    map[s].cod += ph.codEvents != null ? sumEvents(ph.codEvents) : Number(ph.codDeclaredMw  ?? 0);
  }
  return map;
}

export function AddPhasesForm({
  projectId,
  totalCapacityMw,
  existingCodMw,
  plantType,
  windCapacityMw,
  solarCapacityMw,
  bessCapacityMw,
  pspCapacityMw,
  existingPhases = [],
  sourceUsed,
  userRole,
  onSuccess,
  onCancel,
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState(null);
  const { settings } = useSettings();
  // Default expectedMonth = the current reference month (the same value that
  // used to drive the rolling "Exp. May'26" label). ADMIN/NLDC can change it
  // freely; RLDC sees the label locked to that default.
  const defaultExpectedMonth = settings.referenceMonth || (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  const canPickExpectedMonth = userRole === 'ADMIN' || userRole === 'NLDC';
  const refMonthLabel = fmtRefMonth(defaultExpectedMonth);

  // Editable capacities. The plant's Total Capacity (and, for hybrids, each
  // component capacity) can be corrected inline here — e.g. to resolve an
  // "Applied exceeds capacity" violation without leaving the phase editor.
  // Kept as strings so intermediate input states ("47.", "") are allowed;
  // parsed to numbers wherever the pipeline math needs them, so violations and
  // headroom recompute live as the operator types.
  const canEditCaps = EDIT_ROLES_CLIENT.includes(userRole);
  // Capacities are read-only until the user clicks "Edit" — this single toggle
  // flips the Total Capacity stat (and, for hybrids, the component caps) into
  // editable inputs.
  const [editingCaps, setEditingCaps] = useState(false);
  const [caps, setCaps] = useState({
    total: totalCapacityMw != null ? String(totalCapacityMw) : '',
    WIND:  windCapacityMw  != null ? String(windCapacityMw)  : '',
    SOLAR: solarCapacityMw != null ? String(solarCapacityMw) : '',
    BESS:  bessCapacityMw  != null ? String(bessCapacityMw)  : '',
    PSP:   pspCapacityMw   != null ? String(pspCapacityMw)   : '',
  });
  const setCap = (key, value) => setCaps((c) => ({ ...c, [key]: value }));
  const capTotal = parseFloat(caps.total) || 0;
  // True when any persisted capacity differs from its incoming prop value.
  // (PSP has no DB column, so it never participates in persistence.)
  const capsChanged = useMemo(() => {
    const eq = (s, orig) => {
      const a = s === '' || s == null ? null : parseFloat(s);
      const b = orig == null ? null : Number(orig);
      return a === b;
    };
    return !(eq(caps.total, totalCapacityMw)
      && eq(caps.WIND,  windCapacityMw)
      && eq(caps.SOLAR, solarCapacityMw)
      && eq(caps.BESS,  bessCapacityMw));
  }, [caps, totalCapacityMw, windCapacityMw, solarCapacityMw, bessCapacityMw]);

  // Build one row per plant source, every time.
  //   - For hybrids the project has multiple components (Wind / Solar /
  //     BESS / etc.); each one must be addressable in the form even when
  //     it has no DB phase yet, otherwise the operator can't enter
  //     milestones for the missing components (the original bug — a
  //     Wind+Solar+BESS project with only a BESS phase rendered as a
  //     single BESS row, with no way to add Solar or Wind).
  //   - For non-hybrids plantSources has a single entry, so the behaviour
  //     collapses back to one row.
  // Existing DB phases are mapped onto the matching plant-source row so
  // edits land in place (existingId preserved); unmatched plant sources
  // get empty rows pre-typed to their source. Phases that don't map to
  // any plant source (data drift) are appended at the end so they remain
  // visible and editable rather than disappearing silently.
  const plantSources = useMemo(() => getPlantSources(plantType), [plantType]);
  const isEditMode = existingPhases.length > 0;
  const initialPhases = useMemo(() => {
    const byType = new Map();
    for (const ph of existingPhases) {
      if (!byType.has(ph.sourceType)) byType.set(ph.sourceType, ph);
    }
    const rows = plantSources.map((src) => {
      const ph = byType.get(src);
      byType.delete(src);
      return ph
        ? existingPhaseToFormRow(ph, defaultExpectedMonth)
        : { ...EMPTY_PHASE, sourceType: src, expectedMonth: defaultExpectedMonth };
    });
    // Surface any orphaned phases (sourceType not in plantSources) at the
    // end. Usually empty — but better than silently dropping data.
    for (const ph of byType.values()) {
      rows.push(existingPhaseToFormRow(ph, defaultExpectedMonth));
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const form = useForm({
    resolver: zodResolver(createPhasesSchema),
    defaultValues: { phases: initialPhases },
    // Real-time validation — errors surface as the user types so manual
    // entry mistakes (FTC>Applied, TOC>FTC, missing dates, etc.) get caught
    // immediately instead of only at submit.
    mode: 'onChange',
  });

  // Single-phase-per-project: we only need `fields` for iteration. There's
  // no append/remove from the outer phase array (auto-populated per source
  // for hybrids, otherwise one row). Event-level append/remove still works
  // inside each EventList.
  const { fields } = useFieldArray({ control: form.control, name: 'phases' });
  // useWatch (not form.watch) so the cross-milestone pipeline check + Save gate
  // re-render reliably on NESTED edits — editing a TOC/COD event's MW must
  // immediately update the "COD exceeds TOC" banner. form.watch('phases') misses
  // these deep field-array value changes.
  const watchedPhases = useWatch({ control: form.control, name: 'phases' }) ?? [];

  // Counter math:
  //   newCodSum     — COD MW the form will write (across all phase rows)
  //   survivingCod  — COD from existing phases the form is NOT replacing
  // Total project COD after save = survivingCod + newCodSum. So:
  //   pendingMw = totalCapacityMw - (survivingCod + newCodSum)
  // In add-mode (no existingId rows), survivingCod === existingCodMw and
  // the math collapses back to the original.
  const newCodSum = watchedPhases.reduce((s, p) => s + sumEvents(p.codEvents ?? []), 0);
  const survivingCodMw = existingPhases.reduce(
    (s, p) => s + (watchedPhases.some((w) => w.existingId === p.id) ? 0 : Number(p.codDeclaredMw ?? 0)),
    0,
  );
  const pendingMw = capTotal - survivingCodMw - newCodSum;

  const existingPipeline = useMemo(() => computePipeline(existingPhases), [existingPhases]);

  const batchPipeline = useMemo(() =>
    computePipeline(watchedPhases.map((ph) => ({
      sourceType:        ph.sourceType,
      capacityAppliedMw: parseFloat(ph.capacityAppliedMw || '0') || 0,
      ftcEvents:         ph.ftcEvents ?? [],
      tocEvents:         ph.tocEvents ?? [],
      codEvents:         ph.codEvents ?? [],
    }))),
  [watchedPhases]);

  // When a form row has an existingId, it REPLACES that existing phase on
  // save — so the existing phase's contribution shouldn't be double-counted
  // alongside the batch. Compute the subset of existingPipeline that the
  // form is NOT replacing, then add the batch on top.
  const replacedIds = useMemo(
    () => new Set(watchedPhases.map((p) => p.existingId).filter(Boolean)),
    [watchedPhases],
  );
  const survivingExisting = useMemo(
    () => computePipeline(existingPhases.filter((p) => !replacedIds.has(p.id))),
    [existingPhases, replacedIds],
  );
  const combinedPipeline = useMemo(() => {
    const sources = new Set([...Object.keys(survivingExisting), ...Object.keys(batchPipeline)]);
    const out = {};
    for (const s of sources) {
      out[s] = {
        applied: (survivingExisting[s]?.applied ?? 0) + (batchPipeline[s]?.applied ?? 0),
        ftc: (survivingExisting[s]?.ftc ?? 0) + (batchPipeline[s]?.ftc ?? 0),
        toc: (survivingExisting[s]?.toc ?? 0) + (batchPipeline[s]?.toc ?? 0),
        cod: (survivingExisting[s]?.cod ?? 0) + (batchPipeline[s]?.cod ?? 0),
      };
    }
    return out;
  }, [survivingExisting, batchPipeline]);

  // Per-lane capacity ceiling: a single-source project is bounded by the plant's
  // Total Capacity; a hybrid component is bounded by that component's capacity.
  const capForSource = (s) => {
    if (!plantType.isHybrid) return capTotal;
    const v = parseFloat(caps[s]);
    return Number.isFinite(v) ? v : capTotal;
  };

  const pipelineErrors = useMemo(() => {
    const errs = {};
    for (const [s, { applied, ftc, toc, cod }] of Object.entries(combinedPipeline)) {
      const msgs = [];
      const cap = capForSource(s);
      if (cap != null && applied > cap + 0.01) {
        msgs.push(`Applied (${applied.toFixed(1)} MW) exceeds ${plantType.isHybrid ? `${s} ` : ''}capacity (${cap.toFixed(1)} MW)`);
      }
      if (toc > ftc + 0.001) msgs.push(`TOC (${toc.toFixed(1)} MW) exceeds FTC (${ftc.toFixed(1)} MW)`);
      if (cod > toc + 0.001) msgs.push(`COD (${cod.toFixed(1)} MW) exceeds TOC (${toc.toFixed(1)} MW)`);
      if (msgs.length) errs[s] = msgs;
    }
    return errs;
  }, [combinedPipeline, caps, plantType.isHybrid]);

  const hasPipelineErrors = Object.keys(pipelineErrors).length > 0;
  // Also check Zod-level errors (schema refine errors have no path set)
  const zodErrors = form.formState.errors.phases ?? [];

  function onSubmit(values) {
    if (hasPipelineErrors) return;
    setServerError(null);
    startTransition(async () => {
      // Persist any capacity edits first so the corrected ceiling is in place
      // before the phases are (re)written. Only the component caps that the
      // plant actually has are sent; PSP has no DB column so it's omitted.
      if (capsChanged) {
        const capPayload = { totalCapacityMw: caps.total };
        if (plantType.isHybrid) {
          if (windCapacityMw  != null) capPayload.windCapacityMw  = caps.WIND;
          if (solarCapacityMw != null) capPayload.solarCapacityMw = caps.SOLAR;
          if (bessCapacityMw  != null) capPayload.bessCapacityMw  = caps.BESS;
        }
        const capResult = await updateProjectCapacities(projectId, capPayload);
        if (capResult?.error) { setServerError(capResult.error); return; }
      }
      // upsertProjectPhases handles both new and existing phases — rows
      // carrying an existingId update in place; rows without one are
      // created. Saves never duplicate when the form is in edit mode.
      const result = await upsertProjectPhases(projectId, values);
      if (result?.error) {
        const msg = typeof result.error === 'string'
          ? result.error
          : 'Validation failed. Check your inputs and try again.';
        // Auth/session errors → toast (user needs to act, not just read inline)
        if (msg.toLowerCase().includes('session') || msg.toLowerCase().includes('log in')) {
          toast.error(msg);
        } else {
          setServerError(msg);
        }
        return;
      }
      toast.success(`Phase${values.phases.length > 1 ? 's' : ''} saved successfully.`);
      if (onSuccess) { onSuccess(); } else { router.push(`/generation/${projectId}`); }
    });
  }

  return (
    <div className="space-y-5">
      {isPending && (
        <GovLoader overlay size="page" theme="navy" label="Saving phases..." sublabel="Please wait." />
      )}

      {/* ── Capacity + pipeline tracker ── */}
      <div className="rounded-xl border bg-card p-4 space-y-4 sticky top-0 z-10 shadow-sm">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div className="flex gap-6 items-end">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">
                  Total Capacity
                </span>
                {canEditCaps && (
                  <button
                    type="button"
                    onClick={() => setEditingCaps((v) => !v)}
                    className={`inline-flex items-center gap-0.5 text-[10px] font-semibold rounded px-1 py-0.5 transition-colors ${
                      editingCaps
                        ? 'text-emerald-700 hover:bg-emerald-50'
                        : 'text-primary hover:bg-primary/10'
                    }`}
                  >
                    {editingCaps
                      ? (<><Check className="size-3" /> Done</>)
                      : (<><Pencil className="size-2.5" /> Edit</>)}
                  </button>
                )}
              </div>
              {canEditCaps && editingCaps ? (
                <div className="relative w-32">
                  <Input
                    id="total-capacity-input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={caps.total}
                    onChange={(e) => setCap('total', e.target.value)}
                    autoFocus
                    className="h-9 w-full text-lg font-bold font-mono pr-9 border-primary/40 hover:border-primary/60 focus-visible:border-primary transition-colors"
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-muted-foreground pointer-events-none">
                    MW
                  </span>
                </div>
              ) : (
                <p className="text-lg font-bold text-foreground">{capTotal.toFixed(1)} MW</p>
              )}
            </div>
            <Stat label="Already COD"         value={`${existingCodMw.toFixed(1)} MW`}   color="emerald" />
            <Stat label="New COD (this form)" value={`${newCodSum.toFixed(1)} MW`}        color="blue" />
          </div>
          <div className={`px-4 py-2 rounded-lg text-sm font-bold ${
            pendingMw < 0
              ? 'bg-red-50 text-red-700'
              : pendingMw === 0
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-amber-50 text-amber-700'
          }`}>
            {pendingMw < 0
              ? `Over-committed by ${Math.abs(pendingMw).toFixed(1)} MW`
              : pendingMw === 0
              ? 'Fully commissioned'
              : `${pendingMw.toFixed(1)} MW remaining`}
          </div>
        </div>

        {/* Hybrid: per-source pipeline cards */}
        {plantType.isHybrid && (
          <div className="border-t pt-3">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2.5">
              Source Pipeline Status (FTC → TOC → COD)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {windCapacityMw  != null && <SourcePipelineCard source="WIND"  cap={capForSource('WIND')}  existing={existingPipeline.WIND}  combined={combinedPipeline.WIND}  hasError={!!pipelineErrors.WIND}  editable={canEditCaps && editingCaps} capStr={caps.WIND}  onCapChange={(v) => setCap('WIND', v)}  />}
              {solarCapacityMw != null && <SourcePipelineCard source="SOLAR" cap={capForSource('SOLAR')} existing={existingPipeline.SOLAR} combined={combinedPipeline.SOLAR} hasError={!!pipelineErrors.SOLAR} editable={canEditCaps && editingCaps} capStr={caps.SOLAR} onCapChange={(v) => setCap('SOLAR', v)} />}
              {bessCapacityMw  != null && <SourcePipelineCard source="BESS"  cap={capForSource('BESS')}  existing={existingPipeline.BESS}  combined={combinedPipeline.BESS}  hasError={!!pipelineErrors.BESS}  editable={canEditCaps && editingCaps} capStr={caps.BESS}  onCapChange={(v) => setCap('BESS', v)}  />}
              {pspCapacityMw   != null && <SourcePipelineCard source="PSP"   cap={capForSource('PSP')}   existing={existingPipeline.PSP}   combined={combinedPipeline.PSP}   hasError={!!pipelineErrors.PSP}   />}
            </div>
          </div>
        )}
      </div>

      {/* Edit-mode behaviour is implicit — fields below are pre-filled
          with current phase data, and save updates in place via the
          server-side upsert. No banner needed. */}

      {/* Pipeline violation banner */}
      {hasPipelineErrors && (
        <Alert variant="destructive">
          <AlertIcon><AlertCircle /></AlertIcon>
          <div className="flex flex-col gap-2 min-w-0">
            <span className="font-semibold">Source pipeline violation — submission blocked</span>
            <ul className="flex flex-col gap-1.5">
              {Object.entries(pipelineErrors).map(([src, msgs]) => (
                <li key={src} className="flex items-start gap-2 text-sm font-normal">
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border shrink-0 mt-0.5 ${SOURCE_COLORS[src] ?? 'bg-red-100 text-red-800 border-red-200'}`}>
                    {src}
                  </span>
                  <span>{msgs.join('; ')}</span>
                </li>
              ))}
            </ul>
          </div>
        </Alert>
      )}

      {serverError && (
        <Alert variant="destructive">
          <AlertIcon><AlertCircle /></AlertIcon>
          <AlertTitle>{serverError}</AlertTitle>
        </Alert>
      )}

      {/* Phase rows */}
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {fields.map((field, i) => (
          <PhaseRow
            key={field.id}
            index={i}
            form={form}
            isHybrid={plantType.isHybrid}
            availableSources={plantSources}
            existingPipeline={existingPipeline}
            refMonthLabel={refMonthLabel}
            canPickExpectedMonth={canPickExpectedMonth}
            capForSource={capForSource}
          />
        ))}

        {/* "Add Another Phase" was removed — each project has a single
            commissioning phase (per source, for hybrids) and additional
            partial commissioning is captured as FTC / TOC / COD events
            within that phase, not as new phases. */}

        <div className="flex gap-3 justify-end pt-2">
          <Button type="button" variant="outline" onClick={() => onCancel ? onCancel() : router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending || pendingMw < -0.01 || hasPipelineErrors || !form.formState.isValid}>
            {isPending ? 'Saving...' : isEditMode ? 'Save Changes' : 'Save'}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

const MILESTONE_STYLES = {
  FTC: { label: 'FTC Completed',  header: 'bg-blue-50/60 border-blue-100',   badge: 'bg-blue-100 text-blue-800 border-blue-200',   btn: 'border-blue-200 text-blue-700 hover:bg-blue-50' },
  TOC: { label: 'TOC Issued',     header: 'bg-violet-50/60 border-violet-100', badge: 'bg-violet-100 text-violet-800 border-violet-200', btn: 'border-violet-200 text-violet-700 hover:bg-violet-50' },
  COD: { label: 'COD Declared',   header: 'bg-emerald-50/60 border-emerald-100', badge: 'bg-emerald-100 text-emerald-800 border-emerald-200', btn: 'border-emerald-200 text-emerald-700 hover:bg-emerald-50' },
};

function EventList({ phaseIndex, milestone, form, gated, gatedMsg, refMonthLabel, canPickExpectedMonth, limitMw, limitLabel, priorEvents = [], priorLabel }) {
  const prefix = `phases.${phaseIndex}.${milestone.toLowerCase()}Events`;
  const { fields, append, remove } = useFieldArray({ control: form.control, name: prefix });
  const watchedEvents = useWatch({ control: form.control, name: prefix }) ?? [];
  const total = watchedEvents.reduce((s, e) => s + (parseFloat(e.mw) || 0), 0);
  const st = MILESTONE_STYLES[milestone];

  // Cumulative MW limit check for THIS milestone (FTC ≤ Applied, TOC ≤ FTC,
  // COD ≤ TOC). limitMw can be undefined for FTC's first-time use where
  // the limit is implicit in the schema.
  const overLimit  = limitMw != null && total > limitMw + 0.01;
  const remaining  = limitMw != null ? Math.max(0, limitMw - total) : null;

  // Chronology check across milestones. A later-stage milestone (TOC, then COD)
  // must COMPLETE on or after the earlier-stage one — physically FTC happens
  // before TOC before COD. We compare the *latest* date of each milestone:
  // if this milestone's last event predates the prior milestone's last event,
  // the prior milestone was (at least partly) done AFTER this one — e.g. FTC
  // dated 10 Jul while TOC is dated 28 Mar. Using the latest date (not the
  // earliest) tolerates legitimately staged commissioning, where an early
  // tranche of a later milestone can precede the final prior-milestone date.
  const latestDate = (evs) => {
    const dated = (evs ?? []).map((e) => e?.date).filter(Boolean).sort();
    return dated[dated.length - 1] ?? null;
  };
  const latestPriorDate = useMemo(() => latestDate(priorEvents), [priorEvents]);
  const latestThisDate  = latestDate(watchedEvents);
  const datesOutOfOrder = !!(latestPriorDate && latestThisDate && latestThisDate < latestPriorDate);

  return (
    <div className={`rounded-lg border p-3 space-y-2.5 ${overLimit ? 'border-red-300 bg-red-50/30' : st.header}`}>
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${st.badge}`}>
            {milestone}
          </span>
          {total > 0 && (
            <span className={`text-xs font-mono font-semibold ${overLimit ? 'text-red-700' : 'text-foreground'}`}>
              {total.toFixed(2)}{limitMw != null ? ` / ${limitMw.toFixed(2)}` : ''} MW total
              {limitMw != null && remaining != null && !overLimit && (
                <span className="text-[10px] text-muted-foreground font-normal ml-1.5">
                  · {remaining.toFixed(2)} MW headroom
                </span>
              )}
            </span>
          )}
          {gated && (
            <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 font-medium">
              <Lock className="size-3" /> {gatedMsg}
            </span>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground">{fields.length} event{fields.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Real-time guard rails — sum-exceeds-limit + date-out-of-order */}
      {overLimit && (
        <div className="rounded-md border border-red-300 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
          ⚠ Total {milestone} ({total.toFixed(2)} MW) exceeds {limitLabel || 'limit'} ({limitMw.toFixed(2)} MW). Remove or reduce events to fit.
        </div>
      )}
      {datesOutOfOrder && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700">
          ⚠ {priorLabel} (last on {latestPriorDate}) is dated AFTER {milestone} (last on {latestThisDate}). {priorLabel} must be completed on or before {milestone}.
        </div>
      )}

      {/* Event rows */}
      {fields.length > 0 && (
        <div className="rounded-md border border-border overflow-hidden bg-white">
          <div className="grid grid-cols-[1fr_140px_1fr_28px] gap-0 text-[10px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-50 border-b px-2 py-1.5">
            <span>MW</span><span>Date</span><span>Remarks</span><span />
          </div>
          {fields.map((field, ei) => (
            <div key={field.id} className="grid grid-cols-[1fr_140px_1fr_28px] gap-1 items-center px-2 py-1.5 border-b last:border-b-0">
              <Input
                type="number"
                step="0.01"
                placeholder="e.g. 66.66"
                {...form.register(`${prefix}.${ei}.mw`)}
                className="h-8 text-xs font-mono"
              />
              <DatePicker
                value={form.watch(`${prefix}.${ei}.date`) ?? ''}
                onChange={(v) => form.setValue(`${prefix}.${ei}.date`, v, { shouldValidate: true })}
              />
              <Input
                type="text"
                placeholder="Remarks (optional)"
                {...form.register(`${prefix}.${ei}.remarks`)}
                className="h-8 text-xs"
              />
              <button
                type="button"
                onClick={() => remove(ei)}
                className="size-7 flex items-center justify-center text-muted-foreground hover:text-red-600 transition-colors rounded"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add event button */}
      {milestone === 'COD' ? (
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <button
              type="button"
              onClick={() => append({ mw: '', date: '', remarks: '' })}
              disabled={gated}
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border transition-colors disabled:opacity-40 disabled:pointer-events-none ${st.btn}`}
            >
              <Plus className="size-3.5" />
              Add {st.label} Event
            </button>
          </div>
          <div className="w-56">
            <label className="text-[10px] font-medium text-foreground block mb-1 flex items-center gap-1">
              Expected{' '}
              {canPickExpectedMonth ? (
                // ADMIN/NLDC: free month dropdown so back-dated entries can
                // target any month (e.g. recording Apr'26 expected in May).
                <select
                  value={form.watch(`phases.${phaseIndex}.expectedMonth`) ?? ''}
                  onChange={(e) => form.setValue(`phases.${phaseIndex}.expectedMonth`, e.target.value, { shouldValidate: false })}
                  className="inline-flex h-5 rounded border border-input bg-background px-1 text-[10px] font-medium"
                >
                  {MONTH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                // RLDC: locked to the current reference month — show the label only.
                <span className="font-semibold">
                  {fmtMonthShort(form.watch(`phases.${phaseIndex}.expectedMonth`)) || refMonthLabel.replace('Exp. ', '').replace(' (MW)', '')}
                </span>
              )}
              <span>(MW)</span>
            </label>
            <Input
              type="number"
              step="0.01"
              {...form.register(`phases.${phaseIndex}.expectedApr26Mw`)}
              className="h-8 text-xs"
              placeholder="Expected MW"
            />
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => append({ mw: '', date: '', remarks: '' })}
          disabled={gated}
          className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border transition-colors disabled:opacity-40 disabled:pointer-events-none ${st.btn}`}
        >
          <Plus className="size-3.5" />
          Add {st.label} Event
        </button>
      )}
    </div>
  );
}

function PhaseRow({ index, form, isHybrid, availableSources, existingPipeline, refMonthLabel, canPickExpectedMonth, capForSource }) {
  const errors = form.formState.errors.phases?.[index];
  const prefix = `phases.${index}`;
  const selectedSource = form.watch(`${prefix}.sourceType`);
  const srcState = existingPipeline[selectedSource] ?? { ftc: 0, toc: 0, cod: 0 };

  // useWatch (not form.watch) so per-lane limits/warnings re-render reliably on
  // nested event-array edits (add/edit/delete MW) — form.watch can miss these.
  const watchedFtcEvents = useWatch({ control: form.control, name: `${prefix}.ftcEvents` }) ?? [];
  const watchedTocEvents = useWatch({ control: form.control, name: `${prefix}.tocEvents` }) ?? [];
  const watchedCodEvents = useWatch({ control: form.control, name: `${prefix}.codEvents` }) ?? [];
  const ftcTotal = watchedFtcEvents.reduce((s, e) => s + (parseFloat(e.mw) || 0), 0);
  const tocTotal = watchedTocEvents.reduce((s, e) => s + (parseFloat(e.mw) || 0), 0);
  const codTotal = watchedCodEvents.reduce((s, e) => s + (parseFloat(e.mw) || 0), 0);

  const tocGated = isHybrid && srcState.ftc === 0 && ftcTotal === 0;
  const codGated = isHybrid && srcState.toc === 0 && tocTotal === 0;

  // Per-milestone limits for the EventList running-total banner.
  // FTC: bounded by Applied (capacity entered just above). TOC: bounded by
  // total FTC. COD: bounded by total TOC. The form row already holds ALL of
  // this source's events (existing ones are pre-filled), so the running totals
  // ftcTotal / tocTotal ARE the full per-source totals — adding the cached
  // srcState on top double-counts (e.g. TOC limit showed 2× the FTC).
  const appliedMw = parseFloat(useWatch({ control: form.control, name: `${prefix}.capacityAppliedMw` }) || '0') || 0;
  const ftcLimit  = appliedMw > 0 ? appliedMw : null;
  const tocLimit  = ftcTotal;
  const codLimit  = tocTotal;

  // Applied capacity may not exceed the plant's (or component's) total capacity.
  const appliedCap = capForSource ? capForSource(selectedSource) : null;
  const appliedOver = appliedCap != null && appliedMw > appliedCap + 0.01;

  // Auto-derive the dependent fields from the entered milestones/events so they
  // always track add/edit/delete LIVE:
  //   Under FTC = Applied − FTC,  Under TOC = FTC − TOC,  Expected = Applied − COD.
  // These run on open too (not gated on dirty) so a stale stored value is
  // corrected immediately and the fields visibly follow every edit. setValue
  // uses shouldDirty off, so recomputing never marks the form dirty on its own.
  const r3 = (n) => Math.round(n * 1000) / 1000;
  const syncDerived = (field, value) => {
    const cur = parseFloat(form.getValues(`${prefix}.${field}`) || '0') || 0;
    if (Math.abs(cur - value) > 0.001) form.setValue(`${prefix}.${field}`, String(value), { shouldValidate: true });
  };
  useEffect(() => {
    syncDerived('capacityUnderFtcMw', Math.max(0, r3(appliedMw - ftcTotal)));
  }, [appliedMw, ftcTotal]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    syncDerived('capacityUnderTocMw', Math.max(0, r3(ftcTotal - tocTotal)));
  }, [ftcTotal, tocTotal]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    syncDerived('expectedApr26Mw', Math.max(0, r3(appliedMw - codTotal)));
  }, [appliedMw, codTotal]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">
          {selectedSource ? `${selectedSource} Component` : `Source / Component ${index + 1}`}
        </span>
        {/* Per-row Remove button removed — deleting a source/component happens
            via the project detail edit/delete flow, not silently here. */}
      </div>

      {/* Source + Applied */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-foreground block mb-1.5">Source Type *</label>
          <select
            {...form.register(`${prefix}.sourceType`)}
            className={`h-10 w-full rounded-md border border-input px-3 text-sm ${
              availableSources.length === 1 ? 'bg-muted/30 cursor-default pointer-events-none' : 'bg-background'
            }`}
          >
            {availableSources.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {errors?.sourceType && <p className="text-xs text-destructive mt-1">{errors.sourceType.message}</p>}
        </div>
        <div>
          <Field prefix={prefix} name="capacityAppliedMw" label="Capacity Applied (MW) *" type="number" form={form} errors={errors} />
          {appliedOver && (
            <p className="text-xs text-destructive mt-1">
              Applied ({appliedMw.toFixed(1)} MW) exceeds {isHybrid ? `${selectedSource} ` : ''}capacity ({appliedCap.toFixed(1)} MW)
            </p>
          )}
        </div>
      </div>

      {/* Proposed FTC date + Under FTC */}
      <div className="grid grid-cols-2 gap-4">
        <DateField prefix={prefix} name="proposedFtcDate" label="Proposed FTC Date" form={form} errors={errors} />
        <Field prefix={prefix} name="capacityUnderFtcMw" label="Under FTC (MW)" type="number" form={form} errors={errors} />
      </div>

      {/* FTC events */}
      <EventList
        phaseIndex={index}
        milestone="FTC"
        form={form}
        gated={false}
        refMonthLabel={refMonthLabel}
        canPickExpectedMonth={canPickExpectedMonth}
        limitMw={ftcLimit}
        limitLabel="Applied capacity"
      />

      {/* TOC events */}
      <EventList
        phaseIndex={index}
        milestone="TOC"
        form={form}
        gated={tocGated}
        gatedMsg={`Requires ${selectedSource} FTC to be completed first`}
        refMonthLabel={refMonthLabel}
        canPickExpectedMonth={canPickExpectedMonth}
        limitMw={tocLimit}
        limitLabel="Total FTC"
        priorEvents={watchedFtcEvents}
        priorLabel="FTC"
      />

      {/* Under TOC */}
      <div className="grid grid-cols-2 gap-4">
        <Field prefix={prefix} name="capacityUnderTocMw" label="Under TOC (MW)" type="number" form={form} errors={errors} />
      </div>

      {/* COD events */}
      <EventList
        phaseIndex={index}
        milestone="COD"
        form={form}
        gated={codGated}
        gatedMsg={`Requires ${selectedSource} TOC to be issued first`}
        refMonthLabel={refMonthLabel}
        canPickExpectedMonth={canPickExpectedMonth}
        limitMw={codLimit}
        limitLabel="Total TOC"
        priorEvents={watchedTocEvents}
        priorLabel="TOC"
      />

      {/* Remarks */}
      <div className="grid grid-cols-2 gap-4 pt-2 border-t">
        <div>
          <label className="text-xs font-medium text-foreground block mb-1.5">Delay / Issues</label>
          <textarea
            {...form.register(`${prefix}.delayRemarks`)}
            rows={2}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
            placeholder="PSCAD not complied, awaiting models..."
          />
        </div>
        <div>
          <label className="text-xs font-medium text-foreground block mb-1.5">Other Remarks</label>
          <textarea
            {...form.register(`${prefix}.otherRemarks`)}
            rows={2}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
          />
        </div>
      </div>
    </div>
  );
}

function SourcePipelineCard({ source, cap, existing, combined, hasError, editable = false, capStr, onCapChange }) {
  const ex   = existing  ?? { ftc: 0, toc: 0, cod: 0 };
  const comb = combined  ?? { ftc: 0, toc: 0, cod: 0 };

  const stages = [
    { key: 'ftc', label: 'FTC', exMw: ex.ftc,  combMw: comb.ftc,  prev: cap },
    { key: 'toc', label: 'TOC', exMw: ex.toc,  combMw: comb.toc,  prev: comb.ftc },
    { key: 'cod', label: 'COD', exMw: ex.cod,  combMw: comb.cod,  prev: comb.toc },
  ];

  const borderCls = hasError
    ? 'border-red-300 bg-red-50/50'
    : 'border-border bg-muted/10';

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${borderCls}`}>
      <div className="flex items-center justify-between">
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${SOURCE_COLORS[source] ?? 'bg-muted text-foreground border-border'}`}>
          {source}
        </span>
        {editable ? (
          <div className="relative w-24">
            <Input
              type="number"
              step="0.01"
              min="0"
              value={capStr ?? ''}
              onChange={(e) => onCapChange?.(e.target.value)}
              className="h-7 w-full text-xs font-mono text-right pr-7 border-primary/30 hover:border-primary/60 focus-visible:border-primary transition-colors"
            />
            <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground pointer-events-none">MW</span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground font-mono">{cap.toFixed(1)} MW</span>
        )}
      </div>
      <div className="space-y-1.5">
        {stages.map(({ key, label, exMw, combMw, prev }, idx) => {
          const pct       = prev > 0 ? Math.min((combMw / prev) * 100, 100) : 0;
          const locked    = prev === 0 && combMw === 0;
          const hasNew    = combMw > exMw;
          const isViolation = combMw > prev + 0.001;
          return (
            <div key={key}>
              <div className="flex items-center justify-between text-[10px] mb-0.5">
                <span className={`font-semibold uppercase tracking-wide flex items-center gap-1 ${locked ? 'text-muted-foreground' : 'text-foreground'}`}>
                  {locked && <Lock className="size-2.5" />}
                  {label}
                </span>
                <span className={`font-mono ${isViolation ? 'text-red-600 font-bold' : hasNew ? 'text-blue-600' : 'text-muted-foreground'}`}>
                  {combMw.toFixed(1)} MW
                  {hasNew && exMw > 0 && <span className="text-muted-foreground"> (+{(combMw - exMw).toFixed(1)})</span>}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    isViolation ? 'bg-red-500' : locked ? 'bg-muted' : pct >= 100 ? 'bg-emerald-500' : 'bg-blue-500'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Field({ prefix, name, label, type, form, errors }) {
  const id = `${prefix}.${name}`;
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-foreground block mb-1.5">{label}</label>
      <Input
        id={id}
        type={type}
        step={type === 'number' ? '0.01' : undefined}
        {...form.register(`${prefix}.${name}`)}
        className="h-9 text-sm"
      />
      {errors?.[name] && <p className="text-xs text-destructive mt-1">{errors[name].message}</p>}
    </div>
  );
}

function DateField({ prefix, name, label, form, errors }) {
  const value = form.watch(`${prefix}.${name}`) ?? '';
  return (
    <div>
      <label className="text-xs font-medium text-foreground block mb-1.5">{label}</label>
      <DatePicker
        value={value}
        onChange={(v) => form.setValue(`${prefix}.${name}`, v, { shouldValidate: true })}
      />
      {errors?.[name] && <p className="text-xs text-destructive mt-1">{errors[name].message}</p>}
    </div>
  );
}

function Stat({ label, value, color = 'default' }) {
  const colors = { default: 'text-foreground', emerald: 'text-emerald-600', blue: 'text-blue-600' };
  return (
    <div>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">{label}</p>
      <p className={`text-lg font-bold ${colors[color]}`}>{value}</p>
    </div>
  );
}
