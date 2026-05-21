'use client';

import { useState, useTransition, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { contd4Schema } from '@/lib/validations/grid';
import { upsertContd4, clearContd4, addContd4Phase, deleteContd4Phase } from '@/app/actions/grid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import { Alert, AlertIcon, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Pencil, FileText, CheckCircle2, X, Plus, Trash2, History, Info, AlertTriangle } from 'lucide-react';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';

function currentMonthLabel() {
  const now = new Date();
  const month = now.toLocaleString('en-US', { month: 'short' });
  const year  = String(now.getFullYear()).slice(-2);
  return `${month}'${year}`;
}

function monthLabel(yyyyMm) {
  if (!yyyyMm) return null;
  const [y, m] = yyyyMm.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  const mon = d.toLocaleString('en-US', { month: 'short' });
  return `${mon}'${String(y).slice(-2)}`;
}

// 12 months back + 24 months ahead so back-dated phase declarations can
// target a past capacity month (e.g. declaring Apr'26 capacity in May).
function buildMonthOptions() {
  const options = [];
  const now = new Date();
  for (let i = -12; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = monthLabel(value);
    options.push({ value, label });
  }
  return options;
}

const MONTH_OPTIONS = buildMonthOptions();

function AutoResizeTextarea({ value, onChange, className, ...props }) {
  const ref = useRef(null);

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(() => {
    requestAnimationFrame(resize);
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      className={className}
      {...props}
    />
  );
}

const ROLE_REGION_MAP = { SRLDC: 'SR', NRLDC: 'NR', ERLDC: 'ER', WRLDC: 'WR', NERLDC: 'NER' };

function canClearProject(userRole, regionCode) {
  if (userRole === 'ADMIN' || userRole === 'NLDC') return true;
  return ROLE_REGION_MAP[userRole] === regionCode;
}

const STATUS_COLORS = {
  PENDING:  'bg-amber-50 text-amber-700 border-amber-200',
  RECEIVED: 'bg-blue-50 text-blue-700 border-blue-200',
  CLEARED:  'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
};

function toDateInput(date) {
  if (!date) return '';
  return new Date(date).toISOString().split('T')[0];
}

export function Contd4Card({ contd4, projectId, canEdit, userRole, regionCode, notes, onClose }) {
  const [editing, setEditing]         = useState(false);
  const [clearing, setClearing]       = useState(false);
  const [clearNote, setClearNote]     = useState('');
  const [isPending, startTransition]  = useTransition();
  const [isClearPending, startClear]  = useTransition();
  const router = useRouter();

  const showClearButton = contd4
    && contd4.status !== 'CLEARED'
    && canClearProject(userRole, regionCode);

  const canBackdate = userRole === 'ADMIN' || userRole === 'NLDC';
  const todayISO    = new Date().toISOString().slice(0, 10);

  // Pre-fill Effective Date with the back-date applied on the LAST save.
  // contd4.remarksUpdatedAt is the canonical source — every save with an
  // effectiveDate writes it there, and it's the same field the list view
  // reads to render the date beside the remark. Reusing it here keeps the
  // form and the list in sync. Falls back to today when nothing's been
  // saved yet (brand-new contd4 record).
  const lastEffectiveISO = canBackdate
    ? (contd4?.remarksUpdatedAt
        ? new Date(contd4.remarksUpdatedAt).toISOString().slice(0, 10)
        : todayISO)
    : '';
  // `notes` is unused for now but the prop is plumbed in so future logic
  // (e.g. status-only back-dates) can pull from it without another wiring pass.
  void notes;

  const form = useForm({
    resolver: zodResolver(contd4Schema),
    defaultValues: {
      applicationDate: toDateInput(contd4?.applicationDate),
      proposedFtcDate: toDateInput(contd4?.proposedFtcDate),
      // Capacity is now tracked per-phase below; keep these so the schema
      // validator stays happy but never bind them to UI inputs.
      capacityApr26Mw: '',
      capacityMonth:   '',
      status: contd4?.status ?? 'PENDING',
      remarks: contd4?.remarks ?? '',
      effectiveDate: lastEffectiveISO,
    },
  });

  // Phase-level state — used for the Add-Phase inline form below the timeline.
  const phases = contd4?.phases ?? [];
  const [showPhaseForm, setShowPhaseForm] = useState(false);
  const [phaseDate, setPhaseDate]   = useState('');
  const [phaseMw, setPhaseMw]       = useState('');
  const [phaseMonth, setPhaseMonth] = useState('');
  const [phaseNote, setPhaseNote]   = useState('');
  const [phasePending, startPhase]  = useTransition();
  const [deletingId, setDeletingId] = useState(null);

  function resetPhaseForm() {
    setShowPhaseForm(false);
    setPhaseDate(''); setPhaseMw(''); setPhaseMonth(''); setPhaseNote('');
  }

  function submitPhase() {
    if (!phaseDate)          { toast.error('Declared date is required.'); return; }
    const mwNum = parseFloat(phaseMw);
    if (!mwNum || mwNum <= 0) { toast.error('Capacity (MW) must be greater than zero.'); return; }
    startPhase(async () => {
      const result = await addContd4Phase(projectId, {
        declaredDate:  phaseDate,
        capacityMw:    phaseMw,
        capacityMonth: phaseMonth,
        remarks:       phaseNote,
      });
      if (result?.error) toast.error(result.error);
      else {
        toast.success(`Phase recorded: ${mwNum.toFixed(1)} MW${phaseMonth ? ' for ' + monthLabel(phaseMonth) : ''}.`);
        resetPhaseForm();
        router.refresh();
      }
    });
  }

  // Phase-deletion confirmation is done via a proper Radix Dialog modal so
  // it matches the rest of the app's chrome (no more native browser confirm).
  const [phaseToDelete, setPhaseToDelete] = useState(null);   // the phase row
  function askDeletePhase(phase) { setPhaseToDelete(phase); }
  function cancelDeletePhase()    { setPhaseToDelete(null); }
  function confirmDeletePhase() {
    if (!phaseToDelete) return;
    const id = phaseToDelete.id;
    setDeletingId(id);
    startPhase(async () => {
      const result = await deleteContd4Phase(id);
      setDeletingId(null);
      setPhaseToDelete(null);
      if (result?.error) toast.error(result.error);
      else { toast.success('Phase removed.'); router.refresh(); }
    });
  }

  const totalDeclared = phases.reduce((s, p) => s + Number(p.capacityMw || 0), 0);

  function onSubmit(values) {
    startTransition(async () => {
      const result = await upsertContd4(projectId, values);
      if (result?.error) toast.error(typeof result.error === 'string' ? result.error : 'Save failed.');
      else { toast.success('CONTD-4 saved.'); setEditing(false); router.refresh(); }
    });
  }

  function handleClear() {
    startClear(async () => {
      const result = await clearContd4(projectId, clearNote);
      if (result?.error) toast.error(result.error);
      else {
        toast.success('CONTD-4 marked as Cleared. Project moved to FTC Tracker.');
        setClearing(false);
        setClearNote('');
        router.refresh();
        onClose?.();
      }
    });
  }

  if (!contd4 && !editing) {
    return (
      <div className="rounded-xl border border-dashed bg-muted/10 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="size-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">No CONTD-4 application linked.</span>
          </div>
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Add CONTD-4
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b bg-muted/20">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <FileText className="size-4 text-amber-600" /> CONTD-4 Application
          </h2>
          <div className="flex items-center gap-2">
            {showClearButton && !clearing && (
              <button
                onClick={() => setClearing(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md px-2.5 py-1 transition-colors"
              >
                <CheckCircle2 className="size-3.5" /> Mark as Cleared
              </button>
            )}
            {canEdit && !clearing && (
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-md px-2 py-1 transition-colors"
              >
                <Pencil className="size-3.5" /> Edit
              </button>
            )}
          </div>
        </div>
        <div className="px-5 py-4">
          <div className="grid grid-cols-4 gap-x-8 gap-y-4">
            <Detail label="Application Date"  value={toDateInput(contd4.applicationDate) || '—'} />
            <Detail label="Proposed FTC Date" value={toDateInput(contd4.proposedFtcDate) || '—'} />
            <Detail
              label="Total Declared Capacity"
              value={(() => {
                // Prefer the sum of dated phases when any exist (that's the
                // "true" declaration timeline). Fall back to the application-
                // level capacityApr26Mw + capacityMonth pair for legacy
                // onboarding where no phases have been recorded yet.
                if (totalDeclared > 0) {
                  return `${totalDeclared.toFixed(1)} MW · ${phases.length} phase${phases.length !== 1 ? 's' : ''}`;
                }
                const appCap = Number(contd4.capacityApr26Mw ?? 0);
                if (appCap > 0) {
                  return `${appCap.toFixed(1)} MW${contd4.capacityMonth ? ` · for ${monthLabel(contd4.capacityMonth)}` : ''}`;
                }
                return '—';
              })()}
            />
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Status</p>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATUS_COLORS[contd4.status]}`}>
                {contd4.status}
              </span>
            </div>
          </div>
          {/* Application-level remarks only render when there are NO phases
              (single-shot declaration). Once phases exist, remarks live on
              each phase row in the Capacity Phases table below. */}
          {contd4.remarks && phases.length === 0 && (
            <div className="mt-4 pt-4 border-t">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Remarks</p>
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{contd4.remarks}</p>
            </div>
          )}

          {/* ── Capacity phases — append-only timeline of CONTD-4 capacity
              declarations (date + MW + target month). This is DIFFERENT from
              "Commissioning Phases" which record FTC/TOC/COD events. The
              button is renamed accordingly to avoid the ambiguity the user
              hit when both sections had buttons labelled "Add Phase". */}
          <div className="mt-5 pt-4 border-t">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <History className="size-3" /> CONTD-4 Capacity Declarations
              </p>
              {canEdit && !showPhaseForm && (
                <button
                  type="button"
                  onClick={() => { setShowPhaseForm(true); setPhaseDate(toDateInput(new Date())); }}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded px-2 py-0.5 transition-colors"
                >
                  <Plus className="size-3" /> Add CONTD-4 Declaration
                </button>
              )}
            </div>

            {phases.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No CONTD-4 capacity declarations recorded yet. Each declaration preserves the date and MW announced for a target month.</p>
            ) : (
              <div className="overflow-hidden rounded-md border border-slate-200">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 border-b border-slate-200 text-[10px]">
                      <th className="px-2.5 py-1.5 text-left font-semibold">Declared Date</th>
                      <th className="px-2.5 py-1.5 text-right font-semibold">Capacity (MW)</th>
                      <th className="px-2.5 py-1.5 text-left font-semibold">Target Month</th>
                      <th className="px-2.5 py-1.5 text-left font-semibold">Remarks</th>
                      {canEdit && <th className="px-2 py-1.5 w-8" />}
                    </tr>
                  </thead>
                  <tbody>
                    {[...phases]
                      .sort((a, b) => new Date(a.declaredDate) - new Date(b.declaredDate))
                      .map((p, i) => (
                      <tr key={p.id} className={`border-t border-slate-100 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                        <td className="px-2.5 py-1.5 tabular-nums">{toDateInput(p.declaredDate)}</td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums font-semibold text-foreground">{Number(p.capacityMw).toFixed(1)}</td>
                        <td className="px-2.5 py-1.5">{p.capacityMonth ? monthLabel(p.capacityMonth) : <span className="text-slate-400">—</span>}</td>
                        <td className="px-2.5 py-1.5 text-slate-600 truncate max-w-[200px]" title={p.remarks ?? ''}>{p.remarks ?? <span className="text-slate-300">—</span>}</td>
                        {canEdit && (
                          <td className="px-2 py-1.5 text-right">
                            <button
                              type="button"
                              onClick={() => askDeletePhase(p)}
                              disabled={phasePending && deletingId === p.id}
                              className="text-slate-400 hover:text-rose-600 transition-colors disabled:opacity-40"
                              title="Remove this phase"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                    <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                      <td className="px-2.5 py-1.5 uppercase text-[10px] tracking-wide text-slate-500">Total</td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums">{totalDeclared.toFixed(1)}</td>
                      <td colSpan={canEdit ? 3 : 2} />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {showPhaseForm && (
              <div className="mt-3 p-3 rounded-md border border-blue-200 bg-blue-50/40">
                <p className="text-[10px] font-bold uppercase tracking-wide text-blue-700 mb-2">New Capacity Phase</p>
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Declared Date *</p>
                    <DatePicker value={phaseDate} onChange={setPhaseDate} placeholder="YYYY-MM-DD" />
                  </div>
                  <div>
                    <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Capacity (MW) *</p>
                    <Input type="number" step="0.01" placeholder="0" value={phaseMw} onChange={(e) => setPhaseMw(e.target.value)} />
                  </div>
                  <div>
                    <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Target Month</p>
                    <select
                      value={phaseMonth}
                      onChange={(e) => setPhaseMonth(e.target.value)}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">— optional —</option>
                      {MONTH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Remarks</p>
                    <Input placeholder="e.g. partial clearance" value={phaseNote} onChange={(e) => setPhaseNote(e.target.value)} />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-3">
                  <Button type="button" variant="outline" size="sm" onClick={resetPhaseForm} disabled={phasePending}>Cancel</Button>
                  <Button type="button" size="sm" onClick={submitPhase} disabled={phasePending}>
                    {phasePending ? 'Saving…' : 'Save Phase'}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {clearing && (
            <div className="mt-4 pt-4 border-t border-emerald-200 bg-emerald-50/50 rounded-lg p-4">
              <p className="text-xs font-semibold text-emerald-800 mb-2 flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5" /> Confirm Clearance
              </p>
              <p className="text-xs text-emerald-700 mb-3">
                This will mark the CONTD-4 application as <strong>CLEARED</strong>. This action will be logged in the activity feed.
              </p>
              <AutoResizeTextarea
                value={clearNote}
                onChange={(e) => setClearNote(e.target.value)}
                placeholder="Clearance remarks (required)…"
                className="w-full min-h-[56px] rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-emerald-400 placeholder:text-muted-foreground"
              />
              {!clearNote.trim() && (
                <p className="text-[11px] text-rose-600 mt-1">Clearance remarks are required to confirm.</p>
              )}
              <div className="flex justify-end gap-2 mt-2">
                <button
                  onClick={() => { setClearing(false); setClearNote(''); }}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors"
                >
                  <X className="size-3.5" /> Cancel
                </button>
                <button
                  onClick={handleClear}
                  disabled={isClearPending || !clearNote.trim()}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                >
                  <CheckCircle2 className="size-3.5" />
                  {isClearPending ? 'Clearing…' : 'Confirm Clear'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Confirmation dialog for phase deletion — replaces the native
            browser confirm() so styling stays consistent with the app. */}
        <Dialog open={!!phaseToDelete} onOpenChange={(o) => { if (!o) cancelDeletePhase(); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-rose-700">
                <AlertTriangle className="size-4" /> Remove Capacity Phase?
              </DialogTitle>
              <DialogDescription>
                {phaseToDelete && (
                  <>
                    You're about to remove the phase declaring{' '}
                    <span className="font-semibold text-foreground">{Number(phaseToDelete.capacityMw).toFixed(1)} MW</span>
                    {phaseToDelete.capacityMonth && (
                      <> for <span className="font-semibold text-foreground">{monthLabel(phaseToDelete.capacityMonth)}</span></>
                    )}{' '}
                    declared on{' '}
                    <span className="font-semibold text-foreground">{toDateInput(phaseToDelete.declaredDate)}</span>.
                    {phaseToDelete.remarks && (
                      <span className="block mt-2 text-xs italic text-muted-foreground">
                        Remarks: &ldquo;{phaseToDelete.remarks}&rdquo;
                      </span>
                    )}
                    <span className="block mt-3 text-xs text-rose-600">
                      The project's total declared capacity will drop accordingly. This action is logged in the Activity feed.
                    </span>
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={cancelDeletePhase} disabled={phasePending}>
                  Cancel
                </Button>
                <Button type="button" variant="destructive" size="sm" onClick={confirmDeletePhase} disabled={phasePending}>
                  <Trash2 className="size-3.5 mr-1.5" />
                  {phasePending ? 'Removing…' : 'Remove Phase'}
                </Button>
              </div>
            </DialogBody>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-5">
      <h2 className="text-sm font-semibold text-foreground mb-4">
        {contd4 ? 'Edit CONTD-4 Application' : 'Add CONTD-4 Application'}
      </h2>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField control={form.control} name="applicationDate" render={({ field }) => (
              <FormItem>
                <FormLabel>Application Date *</FormLabel>
                <FormControl>
                  <DatePicker value={field.value} onChange={field.onChange} placeholder="Pick application date" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="proposedFtcDate" render={({ field }) => (
              <FormItem>
                <FormLabel>Proposed FTC Date</FormLabel>
                <FormControl>
                  <DatePicker value={field.value} onChange={field.onChange} placeholder="Pick proposed date" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            {/* Capacity is recorded as separate dated phases below the form
                in the read-only view — see "Capacity Phases" section. */}
            {/* For a brand-new CONTD-4 application, status is locked to PENDING.
                Existing applications can be transitioned to RECEIVED / REJECTED
                via this dropdown (CLEARED uses the "Mark as Cleared" action). */}
            <FormField control={form.control} name="status" render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                {contd4 ? (
                  <FormControl>
                    <select {...field} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                      <option value="PENDING">Pending</option>
                      <option value="RECEIVED">Received</option>
                      <option value="CLEARED">Cleared</option>
                      <option value="REJECTED">Rejected</option>
                    </select>
                  </FormControl>
                ) : (
                  <>
                    <FormControl>
                      <input type="hidden" {...field} value="PENDING" />
                    </FormControl>
                    <div className="h-10 flex items-center px-3 rounded-md border border-input bg-muted/30 text-sm">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border bg-amber-50 text-amber-700 border-amber-200">
                        Pending
                      </span>
                      <span className="text-[10px] text-muted-foreground ml-2">— update after creation</span>
                    </div>
                  </>
                )}
                <FormMessage />
              </FormItem>
            )} />
            {/* Application-level Remarks are only meaningful when the project's
                capacity is declared in ONE go (no phases yet). As soon as
                phases exist, remarks belong on the phase rows. We surface that
                rule prominently with an Alert so it isn't missed. */}
            <FormField control={form.control} name="remarks" render={({ field }) => {
              const hasPhases = phases.length > 0;
              return (
                <FormItem className="col-span-2">
                  <FormLabel className={hasPhases ? 'text-muted-foreground' : ''}>Remarks</FormLabel>
                  {hasPhases ? (
                    <Alert variant="info" size="sm" className="items-start">
                      <AlertIcon>
                        <Info className="text-blue-600" />
                      </AlertIcon>
                      <div className="flex-1">
                        <AlertTitle className="text-blue-800 font-semibold">
                          Add remarks on individual phases instead
                        </AlertTitle>
                        <AlertDescription className="text-blue-700 mt-0.5">
                          This project has {phases.length} capacity phase{phases.length === 1 ? '' : 's'}.
                          Application-level remarks are reserved for projects whose capacity is declared in
                          a single shot. Use the <strong>Remarks</strong> column in the Capacity Phases
                          table (or the <strong>Add Phase</strong> form below) so each remark stays tied to
                          its date and MW.
                        </AlertDescription>
                      </div>
                    </Alert>
                  ) : (
                    <FormControl>
                      <AutoResizeTextarea
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        name={field.name}
                        placeholder="Enter remarks…"
                        className="w-full min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring/30 placeholder:text-muted-foreground"
                      />
                    </FormControl>
                  )}
                  <FormMessage />
                </FormItem>
              );
            }} />
            {canBackdate && contd4 && (
              <FormField control={form.control} name="effectiveDate" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Effective Date <span className="text-[10px] text-muted-foreground font-normal">(ADMIN/NLDC only — back-dates the change in history)</span></FormLabel>
                  <FormControl>
                    <DatePicker value={field.value} onChange={field.onChange} placeholder="Defaults to today" />
                  </FormControl>
                  <p className="text-[11px] text-muted-foreground">
                    Snapshots from this date forward will be rebuilt to reflect the change.
                  </p>
                  <FormMessage />
                </FormItem>
              )} />
            )}
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-sm text-foreground">{value}</p>
    </div>
  );
}
