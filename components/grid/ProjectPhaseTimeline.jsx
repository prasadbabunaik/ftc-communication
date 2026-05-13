'use client';

import { useState, useTransition } from 'react';
import { deleteCommissioningPhase, updateCommissioningPhase } from '@/app/actions/grid';
import {
  Trash2, ChevronDown, ChevronUp, AlertTriangle, History, ArrowRight,
  Pencil, Clock, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody,
} from '@/components/ui/dialog';

function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function toDateInput(val) {
  if (!val) return '';
  try { return new Date(val).toISOString().slice(0, 10); } catch { return ''; }
}

function PhaseHistoryEntry({ note }) {
  if (note.field) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-1.5">
            <Pencil className="size-3 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">{note.field.replace(/^Phase \w+ — /, '')}</span>
          </div>
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
            <Clock className="size-2.5" />
            {fmtDateTime(note.createdAt)}
          </span>
        </div>
        <div className="ml-5 flex items-center gap-1.5 flex-wrap">
          {note.oldValue && (
            <span className="text-[11px] text-red-600 bg-red-50 border border-red-100 rounded px-1.5 py-0.5 line-through">{note.oldValue}</span>
          )}
          {note.oldValue && <ArrowRight className="size-3 text-muted-foreground shrink-0" />}
          <span className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded px-1.5 py-0.5 font-medium">{note.newValue || '—'}</span>
        </div>
        <p className="ml-5 mt-1 text-[10px] text-muted-foreground/60">by {note.user?.name ?? 'System'}</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-medium text-foreground">{note.user?.name ?? 'System'}</span>
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
          <Clock className="size-2.5" />
          {fmtDateTime(note.createdAt)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{note.text}</p>
    </div>
  );
}

const SOURCE_COLORS = {
  WIND:  'bg-sky-50 text-sky-700 border-sky-200',
  SOLAR: 'bg-amber-50 text-amber-700 border-amber-200',
  COAL:  'bg-stone-100 text-stone-700 border-stone-200',
  HYDRO: 'bg-blue-50 text-blue-700 border-blue-200',
  PSP:   'bg-violet-50 text-violet-700 border-violet-200',
  BESS:  'bg-emerald-50 text-emerald-700 border-emerald-200',
};

const DELAY_CATEGORIES = [
  { value: '', label: '— Select category —' },
  { value: 'LAND',       label: 'Land Acquisition' },
  { value: 'ENV',        label: 'Environment Clearance' },
  { value: 'GRID',       label: 'Grid Capacity Constraint' },
  { value: 'DEVELOPER',  label: 'Developer Delay' },
  { value: 'REGULATORY', label: 'Regulatory / Approval' },
  { value: 'EQUIPMENT',  label: 'Equipment / Supply Chain' },
  { value: 'FINANCE',    label: 'Financial / Funding' },
  { value: 'OTHER',      label: 'Other' },
];

function FieldGroup({ label, children }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-2">{label}</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">{label}</label>
      {children}
    </div>
  );
}

function NumInput({ value, onChange, placeholder = '0.00' }) {
  return (
    <input
      type="number"
      step="0.01"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
    />
  );
}

function DateInput({ value, onChange }) {
  return (
    <DatePicker
      value={value || ''}
      onChange={v => onChange(v)}
      className="h-9"
    />
  );
}

function PhaseEditModal({ phase, open, onOpenChange, index }) {
  const [isPending, startTransition] = useTransition();

  const [ftcMw,       setFtcMw]       = useState(phase.ftcCompletedMw     != null ? String(Number(phase.ftcCompletedMw))     : '');
  const [ftcDate,     setFtcDate]     = useState(toDateInput(phase.ftcCompletedDate));
  const [underFtcMw,  setUnderFtcMw]  = useState(phase.capacityUnderFtcMw != null ? String(Number(phase.capacityUnderFtcMw)) : '');
  const [proposedFtc, setProposedFtc] = useState(toDateInput(phase.proposedFtcDate));
  const [tocMw,       setTocMw]       = useState(phase.tocIssuedMw        != null ? String(Number(phase.tocIssuedMw))        : '');
  const [tocDate,     setTocDate]     = useState(toDateInput(phase.tocIssuedDate));
  const [underTocMw,  setUnderTocMw]  = useState(phase.capacityUnderTocMw != null ? String(Number(phase.capacityUnderTocMw)) : '');
  const [codMw,       setCodMw]       = useState(phase.codDeclaredMw      != null ? String(Number(phase.codDeclaredMw))      : '');
  const [codDate,     setCodDate]     = useState(toDateInput(phase.codDeclaredDate));
  const [expectedMw,  setExpectedMw]  = useState(phase.expectedApr26Mw    != null ? String(Number(phase.expectedApr26Mw))    : '');
  const [delayCat,    setDelayCat]    = useState(phase.delayCategory ?? '');
  const [delayRem,    setDelayRem]    = useState(phase.delayRemarks ?? '');
  const [otherRem,    setOtherRem]    = useState(phase.otherRemarks ?? '');

  function handleSubmit(e) {
    e.preventDefault();
    startTransition(async () => {
      const result = await updateCommissioningPhase(phase.id, {
        ftcCompletedMw:     ftcMw,
        ftcCompletedDate:   ftcDate,
        proposedFtcDate:    proposedFtc,
        capacityUnderFtcMw: underFtcMw,
        tocIssuedMw:        tocMw,
        tocIssuedDate:      tocDate,
        capacityUnderTocMw: underTocMw,
        codDeclaredMw:      codMw,
        codDeclaredDate:    codDate,
        expectedApr26Mw:    expectedMw,
        delayCategory:      delayCat,
        delayRemarks:       delayRem,
        otherRemarks:       otherRem,
      });
      if (result?.error) {
        toast.error(typeof result.error === 'string' ? result.error : 'Validation error.');
      } else {
        toast.success('Phase updated successfully.');
        onOpenChange(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="size-4 text-blue-500" />
            Edit Phase #{index + 1} — {phase.sourceType}
          </DialogTitle>
          <DialogDescription>
            {Number(phase.capacityAppliedMw).toFixed(1)} MW applied. All MW fields are optional — leave blank to clear.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* FTC */}
            <FieldGroup label="FTC Status">
              <Field label="FTC Approved (MW)">
                <NumInput value={ftcMw} onChange={setFtcMw} />
              </Field>
              <Field label="FTC Date">
                <DateInput value={ftcDate} onChange={setFtcDate} />
              </Field>
              <Field label="Under FTC Process (MW)">
                <NumInput value={underFtcMw} onChange={setUnderFtcMw} />
              </Field>
              <Field label="Proposed FTC Date">
                <DateInput value={proposedFtc} onChange={setProposedFtc} />
              </Field>
            </FieldGroup>

            {/* TOC */}
            <FieldGroup label="TOC Status">
              <Field label="TOC Issued (MW)">
                <NumInput value={tocMw} onChange={setTocMw} />
              </Field>
              <Field label="TOC Date">
                <DateInput value={tocDate} onChange={setTocDate} />
              </Field>
              <Field label="Under TOC Process (MW)">
                <NumInput value={underTocMw} onChange={setUnderTocMw} />
              </Field>
              <div /> {/* spacer */}
            </FieldGroup>

            {/* COD */}
            <FieldGroup label="COD Status">
              <Field label="COD Declared (MW)">
                <NumInput value={codMw} onChange={setCodMw} />
              </Field>
              <Field label="COD Date">
                <DateInput value={codDate} onChange={setCodDate} />
              </Field>
              <Field label="Expected This Month (MW)">
                <NumInput value={expectedMw} onChange={setExpectedMw} />
              </Field>
              <div />
            </FieldGroup>

            {/* Remarks */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-2">Delay / Remarks</p>
              <div className="space-y-3">
                <Field label="Delay Category">
                  <select
                    value={delayCat}
                    onChange={e => setDelayCat(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                  >
                    {DELAY_CATEGORIES.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Delay / Issues Remarks">
                  <textarea
                    value={delayRem}
                    onChange={e => setDelayRem(e.target.value)}
                    rows={2}
                    placeholder="Describe delay reasons or issues…"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 resize-none"
                  />
                </Field>
                <Field label="Other Remarks">
                  <textarea
                    value={otherRem}
                    onChange={e => setOtherRem(e.target.value)}
                    rows={2}
                    placeholder="Any other notes…"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 resize-none"
                  />
                </Field>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1 border-t">
              <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={isPending}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isPending}>
                {isPending ? 'Saving…' : 'Save Changes'}
              </Button>
            </div>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function DateCell({ label, date, mw }) {
  if (!date && !mw) return null;
  return (
    <div className="min-w-[110px]">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
      {mw && <p className="text-sm font-semibold text-foreground">{Number(mw).toFixed(1)} MW</p>}
      {date && <p className="text-xs text-muted-foreground">{fmtDate(date)}</p>}
    </div>
  );
}

function OverdueBadge({ proposedFtcDate, ftcCompletedMw }) {
  if (!proposedFtcDate || ftcCompletedMw) return null;
  const overdue = new Date(proposedFtcDate) < new Date();
  if (!overdue) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border bg-red-50 text-red-700 border-red-200">
      <AlertCircle className="size-3" />
      Overdue
    </span>
  );
}

function PipelineBar({ phase }) {
  const applied  = Number(phase.capacityAppliedMw) || 0;
  if (applied === 0) return null;
  const ftc = Math.min(Number(phase.ftcCompletedMw || 0), applied);
  const toc = Math.min(Number(phase.tocIssuedMw || 0), applied);
  const cod = Math.min(Number(phase.codDeclaredMw || 0), applied);
  const pct = (v) => `${Math.round((v / applied) * 100)}%`;

  return (
    <div className="mt-2 space-y-1">
      {[
        { label: 'FTC', val: ftc, color: 'bg-blue-500' },
        { label: 'TOC', val: toc, color: 'bg-amber-500' },
        { label: 'COD', val: cod, color: 'bg-emerald-500' },
      ].map(({ label, val, color }) => (
        <div key={label} className="flex items-center gap-2">
          <span className="text-[9px] font-mono w-7 text-muted-foreground">{label}</span>
          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${color}`} style={{ width: pct(val) }} />
          </div>
          <span className="text-[9px] text-muted-foreground w-8 text-right">{pct(val)}</span>
        </div>
      ))}
    </div>
  );
}

function PhaseRow({ phase, projectId, canEdit, index }) {
  const [expanded, setExpanded]       = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editOpen, setEditOpen]       = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition]  = useTransition();
  const phaseNotes = phase.notes ?? [];

  const isOverdue = phase.proposedFtcDate && !phase.ftcCompletedMw && new Date(phase.proposedFtcDate) < new Date();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteCommissioningPhase(phase.id);
      setConfirmOpen(false);
      if (result?.error) toast.error(result.error);
      else toast.success('Phase deleted.');
    });
  }

  const delayCatLabel = phase.delayCategory
    ? DELAY_CATEGORIES.find(c => c.value === phase.delayCategory)?.label ?? phase.delayCategory
    : null;

  return (
    <div className={`rounded-lg border bg-card transition-all ${isPending ? 'opacity-50' : ''} ${isOverdue ? 'border-red-200' : ''}`}>
      {/* Phase header row */}
      <div
        className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-muted/20 rounded-lg"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-2 min-w-[160px]">
          <span className="text-xs text-muted-foreground font-mono">#{index + 1}</span>
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${SOURCE_COLORS[phase.sourceType]}`}>
            {phase.sourceType}
          </span>
          <span className="font-semibold text-sm">{Number(phase.capacityAppliedMw).toFixed(1)} MW</span>
          <OverdueBadge proposedFtcDate={phase.proposedFtcDate} ftcCompletedMw={phase.ftcCompletedMw} />
        </div>

        <div className="flex gap-6 flex-1 flex-wrap">
          <DateCell label="FTC"  mw={phase.ftcCompletedMw}  date={phase.ftcCompletedDate} />
          <DateCell label="TOC"  mw={phase.tocIssuedMw}     date={phase.tocIssuedDate} />
          <DateCell label="COD"  mw={phase.codDeclaredMw}   date={phase.codDeclaredDate} />
          {phase.expectedApr26Mw && (
            <div className="min-w-[110px]">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Expected</p>
              <p className="text-sm font-semibold text-foreground">{Number(phase.expectedApr26Mw).toFixed(1)} MW</p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 ml-auto">
          <button
            type="button"
            title="Change history"
            onClick={(e) => { e.stopPropagation(); setHistoryOpen(true); }}
            className="relative text-muted-foreground hover:text-blue-600 transition-colors p-1.5 rounded"
          >
            <History className="size-4" />
            {phaseNotes.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-blue-500 text-[8px] font-bold text-white">
                {phaseNotes.length > 9 ? '9+' : phaseNotes.length}
              </span>
            )}
          </button>
          {canEdit && (
            <>
              <button
                type="button"
                title="Edit phase"
                onClick={(e) => { e.stopPropagation(); setEditOpen(true); }}
                className="text-muted-foreground hover:text-blue-600 transition-colors p-1.5 rounded"
              >
                <Pencil className="size-4" />
              </button>
              <button
                type="button"
                title="Delete phase"
                onClick={(e) => { e.stopPropagation(); setConfirmOpen(true); }}
                className="text-muted-foreground hover:text-red-600 transition-colors p-1.5 rounded"
              >
                <Trash2 className="size-4" />
              </button>
            </>
          )}
          {expanded ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
        </div>
      </div>

      {/* Edit modal */}
      <PhaseEditModal
        phase={phase}
        open={editOpen}
        onOpenChange={setEditOpen}
        index={index}
      />

      {/* Delete confirm modal */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-4" /> Delete Phase
            </DialogTitle>
            <DialogDescription>
              Permanently delete phase #{index + 1} ({phase.sourceType} — {Number(phase.capacityAppliedMw).toFixed(1)} MW). Cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmOpen(false)} disabled={isPending}>Cancel</Button>
              <Button variant="destructive" size="sm" onClick={handleDelete} disabled={isPending}>
                {isPending ? 'Deleting…' : 'Delete Phase'}
              </Button>
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>

      {/* Phase history modal */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="size-4 text-blue-500" />
              Phase #{index + 1} — {phase.sourceType} Change History
            </DialogTitle>
            <DialogDescription>
              {Number(phase.capacityAppliedMw).toFixed(1)} MW applied · {phaseNotes.length} event{phaseNotes.length !== 1 ? 's' : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {phaseNotes.length === 0 ? (
              <div className="py-8 text-center">
                <History className="size-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No changes recorded for this phase yet.</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Changes appear here after the phase is edited.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
                {[...phaseNotes].reverse().map((note) => (
                  <PhaseHistoryEntry key={note.id} note={note} />
                ))}
              </div>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 border-t pt-3 space-y-3">
          <PipelineBar phase={phase} />

          <div className="flex gap-6 flex-wrap">
            {phase.proposedFtcDate && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Proposed FTC</p>
                <p className={`text-xs font-medium ${isOverdue ? 'text-red-600' : 'text-foreground'}`}>
                  {fmtDate(phase.proposedFtcDate)}
                  {isOverdue && ' — overdue'}
                </p>
              </div>
            )}
            {phase.capacityUnderFtcMw != null && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Under FTC</p>
                <p className="text-xs text-foreground">{Number(phase.capacityUnderFtcMw).toFixed(1)} MW</p>
              </div>
            )}
            {phase.capacityUnderTocMw != null && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Under TOC</p>
                <p className="text-xs text-foreground">{Number(phase.capacityUnderTocMw).toFixed(1)} MW</p>
              </div>
            )}
          </div>

          {delayCatLabel && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Delay Category</p>
              <span className="inline-flex items-center mt-0.5 px-2 py-0.5 rounded text-[11px] font-medium border bg-orange-50 text-orange-700 border-orange-200">
                {delayCatLabel}
              </span>
            </div>
          )}
          {phase.delayRemarks && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Delay / Issues</p>
              <p className="text-xs text-foreground mt-0.5">{phase.delayRemarks}</p>
            </div>
          )}
          {phase.otherRemarks && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Other Remarks</p>
              <p className="text-xs text-foreground mt-0.5">{phase.otherRemarks}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ProjectPhaseTimeline({ phases, projectId, canEdit }) {
  if (!phases?.length) {
    return (
      <div className="rounded-xl border border-dashed bg-muted/20 p-8 text-center">
        <CheckCircle2 className="size-8 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No commissioning phases yet.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {phases.map((phase, i) => (
        <PhaseRow key={phase.id} phase={phase} projectId={projectId} canEdit={canEdit} index={i} />
      ))}
    </div>
  );
}
