'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createPhasesSchema } from '@/lib/validations/grid';
import { addCommissioningPhases } from '@/app/actions/grid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import { Alert, AlertIcon, AlertTitle } from '@/components/ui/alert';
import { GovLoader } from '@/components/ui/gov-loader';
import { AlertCircle, Plus, Trash2, Lock } from 'lucide-react';
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
  sourceType:         'SOLAR',
  capacityAppliedMw:  '',
  proposedFtcDate:    '',
  capacityUnderFtcMw: '',
  capacityUnderTocMw: '',
  expectedApr26Mw:    '',
  delayRemarks:       '',
  otherRemarks:       '',
  ftcEvents:          [],
  tocEvents:          [],
  codEvents:          [],
};

function sumEvents(evs) {
  // Form events use `mw`; DB-serialised events (from enriched phases) use `capacityMw`
  return (evs ?? []).reduce((s, e) => s + (parseFloat(e.mw ?? e.capacityMw) || 0), 0);
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
  existingPhases = [],
  sourceUsed,
  onSuccess,
  onCancel,
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState(null);
  const { settings } = useSettings();
  const refMonthLabel = fmtRefMonth(settings.referenceMonth);

  // Derive valid sources from plant type; pre-populate one phase per source
  const plantSources = useMemo(() => getPlantSources(plantType), [plantType]);
  const initialPhases = useMemo(
    () => plantSources.map((s) => ({ ...EMPTY_PHASE, sourceType: s })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const form = useForm({
    resolver: zodResolver(createPhasesSchema),
    defaultValues: { phases: initialPhases },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'phases' });
  const watchedPhases = form.watch('phases');

  const newCodSum = watchedPhases.reduce((s, p) => s + sumEvents(p.codEvents ?? []), 0);
  const pendingMw = totalCapacityMw - existingCodMw - newCodSum;

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

  const combinedPipeline = useMemo(() => {
    const sources = new Set([...Object.keys(existingPipeline), ...Object.keys(batchPipeline)]);
    const out = {};
    for (const s of sources) {
      out[s] = {
        ftc: (existingPipeline[s]?.ftc ?? 0) + (batchPipeline[s]?.ftc ?? 0),
        toc: (existingPipeline[s]?.toc ?? 0) + (batchPipeline[s]?.toc ?? 0),
        cod: (existingPipeline[s]?.cod ?? 0) + (batchPipeline[s]?.cod ?? 0),
      };
    }
    return out;
  }, [existingPipeline, batchPipeline]);

  const pipelineErrors = useMemo(() => {
    const errs = {};
    for (const [s, { ftc, toc, cod }] of Object.entries(combinedPipeline)) {
      const msgs = [];
      if (toc > ftc + 0.001) msgs.push(`TOC (${toc.toFixed(1)} MW) exceeds FTC (${ftc.toFixed(1)} MW)`);
      if (cod > toc + 0.001) msgs.push(`COD (${cod.toFixed(1)} MW) exceeds TOC (${toc.toFixed(1)} MW)`);
      if (msgs.length) errs[s] = msgs;
    }
    return errs;
  }, [combinedPipeline]);

  const hasPipelineErrors = Object.keys(pipelineErrors).length > 0;
  // Also check Zod-level errors (schema refine errors have no path set)
  const zodErrors = form.formState.errors.phases ?? [];

  function onSubmit(values) {
    if (hasPipelineErrors) return;
    setServerError(null);
    startTransition(async () => {
      const result = await addCommissioningPhases(projectId, values);
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
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex gap-6">
            <Stat label="Total Capacity"      value={`${totalCapacityMw.toFixed(1)} MW`} />
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
              {windCapacityMw  != null && <SourcePipelineCard source="WIND"  cap={windCapacityMw}  existing={existingPipeline.WIND}  combined={combinedPipeline.WIND}  hasError={!!pipelineErrors.WIND}  />}
              {solarCapacityMw != null && <SourcePipelineCard source="SOLAR" cap={solarCapacityMw} existing={existingPipeline.SOLAR} combined={combinedPipeline.SOLAR} hasError={!!pipelineErrors.SOLAR} />}
              {bessCapacityMw  != null && <SourcePipelineCard source="BESS"  cap={bessCapacityMw}  existing={existingPipeline.BESS}  combined={combinedPipeline.BESS}  hasError={!!pipelineErrors.BESS}  />}
            </div>
          </div>
        )}
      </div>

      {/* Pipeline violation banner */}
      {hasPipelineErrors && (
        <Alert variant="destructive">
          <AlertIcon><AlertCircle /></AlertIcon>
          <AlertTitle>
            <span className="font-semibold">Source pipeline violation — submission blocked</span>
            {Object.entries(pipelineErrors).map(([src, msgs]) => (
              <div key={src} className="mt-1 text-sm font-normal">
                <span className="font-semibold">{src}:</span> {msgs.join('; ')}
              </div>
            ))}
          </AlertTitle>
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
            onRemove={() => remove(i)}
            showRemove={fields.length > 1}
            isHybrid={plantType.isHybrid}
            availableSources={plantSources}
            existingPipeline={existingPipeline}
            refMonthLabel={refMonthLabel}
          />
        ))}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => append({ ...EMPTY_PHASE, sourceType: plantSources[0] })}
          className="w-full border-dashed"
        >
          <Plus className="size-4 mr-2" /> Add Another Phase
        </Button>

        <div className="flex gap-3 justify-end pt-2">
          <Button type="button" variant="outline" onClick={() => onCancel ? onCancel() : router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending || pendingMw < -0.01 || hasPipelineErrors || !form.formState.isValid}>
            {isPending ? 'Saving...' : `Save ${fields.length} Phase${fields.length > 1 ? 's' : ''}`}
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

function EventList({ phaseIndex, milestone, form, gated, gatedMsg, existingMw, refMonthLabel }) {
  const prefix = `phases.${phaseIndex}.${milestone.toLowerCase()}Events`;
  const { fields, append, remove } = useFieldArray({ control: form.control, name: prefix });
  const watchedEvents = form.watch(prefix) ?? [];
  const total = watchedEvents.reduce((s, e) => s + (parseFloat(e.mw) || 0), 0);
  const st = MILESTONE_STYLES[milestone];

  return (
    <div className={`rounded-lg border p-3 space-y-2.5 ${st.header}`}>
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${st.badge}`}>
            {milestone}
          </span>
          {total > 0 && (
            <span className="text-xs font-mono font-semibold text-foreground">
              {total.toFixed(2)} MW total
            </span>
          )}
          {existingMw > 0 && (
            <span className="text-[10px] text-emerald-600 font-medium">
              ({existingMw.toFixed(1)} MW already recorded)
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
          <div className="w-44">
            <label className="text-[10px] font-medium text-foreground block mb-1">{refMonthLabel}</label>
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

function PhaseRow({ index, form, onRemove, showRemove, isHybrid, availableSources, existingPipeline, refMonthLabel }) {
  const errors = form.formState.errors.phases?.[index];
  const prefix = `phases.${index}`;
  const selectedSource = form.watch(`${prefix}.sourceType`);
  const srcState = existingPipeline[selectedSource] ?? { ftc: 0, toc: 0, cod: 0 };

  const watchedFtcEvents = form.watch(`${prefix}.ftcEvents`) ?? [];
  const watchedTocEvents = form.watch(`${prefix}.tocEvents`) ?? [];
  const ftcTotal = watchedFtcEvents.reduce((s, e) => s + (parseFloat(e.mw) || 0), 0);
  const tocTotal = watchedTocEvents.reduce((s, e) => s + (parseFloat(e.mw) || 0), 0);

  const tocGated = isHybrid && srcState.ftc === 0 && ftcTotal === 0;
  const codGated = isHybrid && srcState.toc === 0 && tocTotal === 0;

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">Phase {index + 1}</span>
        {showRemove && (
          <button type="button" onClick={onRemove} className="text-muted-foreground hover:text-red-600 transition-colors p-1">
            <Trash2 className="size-4" />
          </button>
        )}
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
        existingMw={isHybrid ? srcState.ftc : 0}
        refMonthLabel={refMonthLabel}
      />

      {/* TOC events */}
      <EventList
        phaseIndex={index}
        milestone="TOC"
        form={form}
        gated={tocGated}
        gatedMsg={`Requires ${selectedSource} FTC to be completed first`}
        existingMw={isHybrid ? srcState.toc : 0}
        refMonthLabel={refMonthLabel}
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
        existingMw={isHybrid ? srcState.cod : 0}
        refMonthLabel={refMonthLabel}
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

function SourcePipelineCard({ source, cap, existing, combined, hasError }) {
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
        <span className="text-xs text-muted-foreground font-mono">{cap.toFixed(1)} MW</span>
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
  return (
    <div>
      <label className="text-xs font-medium text-foreground block mb-1.5">{label}</label>
      <Input
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
