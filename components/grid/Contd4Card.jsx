'use client';

import { useState, useTransition, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { contd4Schema } from '@/lib/validations/grid';
import { upsertContd4, clearContd4 } from '@/app/actions/grid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import { toast } from 'sonner';
import { Pencil, FileText, CheckCircle2, X } from 'lucide-react';
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

function buildMonthOptions() {
  const options = [];
  const now = new Date();
  for (let i = 0; i < 24; i++) {
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

export function Contd4Card({ contd4, projectId, canEdit, userRole, regionCode, onClose }) {
  const [editing, setEditing]         = useState(false);
  const [clearing, setClearing]       = useState(false);
  const [clearNote, setClearNote]     = useState('');
  const [isPending, startTransition]  = useTransition();
  const [isClearPending, startClear]  = useTransition();
  const router = useRouter();

  const showClearButton = contd4
    && contd4.status !== 'CLEARED'
    && canClearProject(userRole, regionCode);

  const form = useForm({
    resolver: zodResolver(contd4Schema),
    defaultValues: {
      applicationDate: toDateInput(contd4?.applicationDate),
      proposedFtcDate: toDateInput(contd4?.proposedFtcDate),
      capacityApr26Mw: contd4?.capacityApr26Mw ? String(contd4.capacityApr26Mw) : '',
      capacityMonth:   contd4?.capacityMonth ?? '',
      status: contd4?.status ?? 'PENDING',
      remarks: contd4?.remarks ?? '',
    },
  });

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
            <Detail label="Application Date"  value={toDateInput(contd4.applicationDate)} />
            <Detail label="Proposed FTC Date" value={toDateInput(contd4.proposedFtcDate) || '—'} />
            <Detail
              label={`Declared Capacity${contd4.capacityMonth ? ` (${monthLabel(contd4.capacityMonth)})` : ''}`}
              value={contd4.capacityApr26Mw ? `${Number(contd4.capacityApr26Mw).toFixed(1)} MW` : '—'}
            />
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Status</p>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATUS_COLORS[contd4.status]}`}>
                {contd4.status}
              </span>
            </div>
          </div>
          {contd4.remarks && (
            <div className="mt-4 pt-4 border-t">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Remarks</p>
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{contd4.remarks}</p>
            </div>
          )}

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
                placeholder="Clearance remarks (optional)…"
                className="w-full min-h-[56px] rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-emerald-400 placeholder:text-muted-foreground"
              />
              <div className="flex justify-end gap-2 mt-2">
                <button
                  onClick={() => { setClearing(false); setClearNote(''); }}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors"
                >
                  <X className="size-3.5" /> Cancel
                </button>
                <button
                  onClick={handleClear}
                  disabled={isClearPending}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors font-medium"
                >
                  <CheckCircle2 className="size-3.5" />
                  {isClearPending ? 'Clearing…' : 'Confirm Clear'}
                </button>
              </div>
            </div>
          )}
        </div>
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
            <FormField control={form.control} name="capacityApr26Mw" render={({ field }) => (
              <FormItem>
                <FormLabel className="flex items-center gap-1.5 flex-wrap">
                  Capacity for
                  <select
                    value={form.watch('capacityMonth') ?? ''}
                    onChange={(e) => form.setValue('capacityMonth', e.target.value, { shouldValidate: true })}
                    className="inline-flex h-6 rounded border border-input bg-background px-1.5 text-xs font-normal"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <option value="">— month —</option>
                    {MONTH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  (MW)
                </FormLabel>
                <FormControl><Input type="number" step="0.01" placeholder="0" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="status" render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <FormControl>
                  <select {...field} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                    <option value="PENDING">Pending</option>
                    <option value="RECEIVED">Received</option>
                    <option value="CLEARED">Cleared</option>
                    <option value="REJECTED">Rejected</option>
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="remarks" render={({ field }) => (
              <FormItem className="col-span-2">
                <FormLabel>Remarks</FormLabel>
                <FormControl>
                  <AutoResizeTextarea
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    name={field.name}
                    placeholder="Enter remarks…"
                    className="w-full min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring/30 placeholder:text-muted-foreground"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
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
