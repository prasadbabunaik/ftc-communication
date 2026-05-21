'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createProjectSchema } from '@/lib/validations/grid';
import { createGenerationProject, createPoolingStation } from '@/app/actions/grid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import { Combobox } from '@/components/ui/combobox';
import { Alert, AlertIcon, AlertTitle } from '@/components/ui/alert';
import { GovLoader } from '@/components/ui/gov-loader';
import { AlertCircle, Plus } from 'lucide-react';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody,
} from '@/components/ui/dialog';

function monthLabel(yyyyMm) {
  if (!yyyyMm) return null;
  const [y, m] = yyyyMm.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  const mon = d.toLocaleString('en-US', { month: 'short' });
  return `${mon}'${String(y).slice(-2)}`;
}

// 12 months back + 24 months ahead. Past months are needed because ADMIN/NLDC
// can record back-dated CONTD-4 declarations for capacity that was committed
// in a prior month (e.g. seeding April data in May).
function buildMonthOptions() {
  const options = [];
  const now = new Date();
  for (let i = -12; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    options.push({ value, label: monthLabel(value) });
  }
  return options;
}

const MONTH_OPTIONS = buildMonthOptions();

const SOURCE_OPTIONS = [
  { key: 'WIND',  label: 'Wind'  },
  { key: 'SOLAR', label: 'Solar' },
  { key: 'BESS',  label: 'BESS'  },
  { key: 'COAL',  label: 'Coal'  },
  { key: 'HYDRO', label: 'Hydro' },
  { key: 'PSP',   label: 'PSP'   },
];

// Keys are alphabetically-sorted, comma-joined source-type sets. Must cover
// every hybrid plant_type code present in the DB so the UI doesn't show
// "Unknown source combination" for valid picks (e.g. Solar + PSP for hybrids
// like Greenko AP01 IREP at Kurnool, which is HYBRID_SP in DB).
const SOURCE_TO_CODE = {
  'BESS':             'BESS',
  'COAL':             'COAL',
  'HYDRO':            'HYDRO',
  'PSP':              'PSP',
  'SOLAR':            'SOLAR',
  'WIND':             'WIND',
  'BESS,SOLAR':       'HYBRID_SB',
  'BESS,WIND':        'HYBRID_WB',
  'SOLAR,WIND':       'HYBRID_WS',
  'BESS,SOLAR,WIND':  'HYBRID_WSB',
  'PSP,SOLAR':        'HYBRID_SP',
  'PSP,WIND':         'HYBRID_WP',
  'HYDRO,PSP':        'HYBRID_HP',
};

function derivePlantType(sources, plantTypes) {
  if (sources.length === 0) return { code: null, id: null, label: null };
  const key = [...sources].sort().join(',');
  const code = SOURCE_TO_CODE[key] ?? null;
  if (!code) return { code: null, id: null, label: null, error: 'Unknown source combination' };
  const pt = plantTypes.find((p) => p.code === code);
  return pt ? { code, id: pt.id, label: pt.label } : { code, id: null, label: null, error: 'Plant type not found' };
}

export function CreateProjectForm({ regions, plantTypes, poolingStations: initialPS, lockedRegionId, userRole, onSuccess, onCancel }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState(null);
  const [dynamicPS, setDynamicPS] = useState(initialPS);
  const [addPsOpen, setAddPsOpen] = useState(false);
  const [newPsName, setNewPsName] = useState('');
  const [newPsVoltage, setNewPsVoltage] = useState('');
  const [addPsError, setAddPsError] = useState(null);
  const [addPsPending, startAddPsTransition] = useTransition();
  const [selectedSources, setSelectedSources] = useState([]);

  const canBackdate = userRole === 'ADMIN' || userRole === 'NLDC';
  const todayISO    = new Date().toISOString().slice(0, 10);

  const form = useForm({
    resolver: zodResolver(createProjectSchema),
    defaultValues: {
      name: '',
      developerName: '',
      regionId: lockedRegionId ?? '',
      plantTypeId: '',
      poolingStationId: '',
      totalCapacityMw: '',
      windCapacityMw: '',
      solarCapacityMw: '',
      bessCapacityMw: '',
      createContd4: false,
      contd4: {
        applicationDate: '',
        proposedFtcDate: '',
        capacityApr26Mw: '',
        capacityMonth:   '',
        status: 'PENDING',
        remarks: '',
      },
      effectiveDate: canBackdate ? todayISO : '',
    },
  });

  const watchedRegionId = form.watch('regionId');
  const watchedContd4   = form.watch('createContd4');

  const derived = derivePlantType(selectedSources, plantTypes);

  const isHybrid = selectedSources.length > 1 && selectedSources.every((s) => ['WIND', 'SOLAR', 'BESS'].includes(s));
  const hasWind  = selectedSources.includes('WIND');
  const hasSolar = selectedSources.includes('SOLAR');
  const hasBess  = selectedSources.includes('BESS');

  useEffect(() => {
    form.setValue('plantTypeId', derived.id ?? '', { shouldValidate: true });
  }, [derived.id]);

  useEffect(() => {
    if (!watchedRegionId || lockedRegionId) return;
    fetch(`/api/grid/pooling-stations?regionId=${watchedRegionId}`)
      .then((r) => r.json())
      .then((d) => setDynamicPS(d.data ?? []))
      .catch(() => {});
  }, [watchedRegionId, lockedRegionId]);

  function toggleSource(key) {
    setSelectedSources((prev) =>
      prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]
    );
  }

  function onSubmit(values) {
    setServerError(null);
    startTransition(async () => {
      const result = await createGenerationProject(values);
      if (result?.error) {
        if (typeof result.error === 'string') setServerError(result.error);
        else setServerError('Please fix the form errors and try again.');
        return;
      }
      if (onSuccess) {
        onSuccess(result.id);
      } else {
        router.push(`/generation/${result.id}`);
      }
    });
  }

  function handleAddPs() {
    setAddPsError(null);
    const regionId = form.getValues('regionId');
    if (!regionId) { setAddPsError('Select a region first.'); return; }
    if (!newPsName.trim()) { setAddPsError('Station name is required.'); return; }
    startAddPsTransition(async () => {
      const result = await createPoolingStation({ name: newPsName.trim(), regionId, voltageKv: newPsVoltage || null });
      if (result?.error) { setAddPsError(result.error); return; }
      const newStation = result.station;
      setDynamicPS((prev) => [...prev, newStation]);
      form.setValue('poolingStationId', newStation.id);
      setNewPsName(''); setNewPsVoltage(''); setAddPsOpen(false);
    });
  }

  const ps = lockedRegionId ? initialPS : dynamicPS;

  return (
    <Form {...form}>
      {isPending && (
        <GovLoader overlay size="page" theme="navy" label="Saving project..." sublabel="Please wait." />
      )}

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {serverError && (
          <Alert variant="destructive">
            <AlertIcon><AlertCircle /></AlertIcon>
            <AlertTitle>{serverError}</AlertTitle>
          </Alert>
        )}

        {/* ── Basic Details ── */}
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <h2 className="font-semibold text-sm text-foreground">Project Details</h2>

          <FormField control={form.control} name="developerName" render={({ field }) => (
            <FormItem>
              <FormLabel>Name of Developer</FormLabel>
              <FormControl><Input placeholder="e.g. Juniper Green Energy Limited" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />

          <FormField control={form.control} name="name" render={({ field }) => (
            <FormItem>
              <FormLabel>Generating Station Name *</FormLabel>
              <FormControl><Input placeholder="e.g. Ran JGEPL" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />

          <div className="grid grid-cols-2 gap-4">
            <FormField control={form.control} name="regionId" render={({ field }) => (
              <FormItem>
                <FormLabel>Region *</FormLabel>
                <FormControl>
                  <select
                    {...field}
                    disabled={!!lockedRegionId}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
                  >
                    <option value="">Select region...</option>
                    {regions.map((r) => <option key={r.id} value={r.id}>{r.code} — {r.name}</option>)}
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            {/* Plant Type — hidden field for validation, driven by source checkboxes */}
            <FormField control={form.control} name="plantTypeId" render={() => (
              <FormItem>
                <FormLabel>Plant Type *</FormLabel>
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {SOURCE_OPTIONS.map(({ key, label }) => {
                      const active = selectedSources.includes(key);
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => toggleSource(key)}
                          className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors select-none ${
                            active
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-background text-foreground border-input hover:bg-muted'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  {selectedSources.length > 0 && (
                    <p className={`text-xs font-medium ${derived.error ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {derived.error
                        ? `⚠ ${derived.error}`
                        : `→ ${derived.label}`}
                    </p>
                  )}
                </div>
                <FormMessage />
              </FormItem>
            )} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField control={form.control} name="poolingStationId" render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between">
                  <FormLabel>Pooling Station</FormLabel>
                  <button
                    type="button"
                    onClick={() => { setAddPsError(null); setAddPsOpen(true); }}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >
                    <Plus className="size-3" /> Add new
                  </button>
                </div>
                <FormControl>
                  <Combobox
                    options={ps.map((s) => ({ value: s.id, label: s.name }))}
                    value={field.value}
                    onChange={field.onChange}
                    placeholder="Select pooling station…"
                    searchPlaceholder="Search stations…"
                    emptyText="No matching station. Use + Add new."
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="totalCapacityMw" render={({ field }) => (
              <FormItem>
                <FormLabel>Total Capacity (MW) *</FormLabel>
                <FormControl><Input type="number" step="0.01" placeholder="500.00" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>
        </div>

        {/* ── Hybrid Breakdown ── */}
        {isHybrid && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-5 space-y-4">
            <div>
              <h2 className="font-semibold text-sm text-amber-800">Hybrid Plant Capacity Breakdown</h2>
              <p className="text-xs text-amber-700 mt-0.5">
                {selectedSources.filter((s) => ['WIND', 'SOLAR', 'BESS'].includes(s)).join(' + ')} must sum to total capacity.
              </p>
            </div>

            <div className={`grid gap-4 ${[hasWind, hasSolar, hasBess].filter(Boolean).length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
              {hasWind && (
                <FormField control={form.control} name="windCapacityMw" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Wind (MW) *</FormLabel>
                    <FormControl><Input type="number" step="0.01" placeholder="300.00" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              )}

              {hasSolar && (
                <FormField control={form.control} name="solarCapacityMw" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Solar (MW) *</FormLabel>
                    <FormControl><Input type="number" step="0.01" placeholder="200.00" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              )}

              {hasBess && (
                <FormField control={form.control} name="bessCapacityMw" render={({ field }) => (
                  <FormItem>
                    <FormLabel>BESS (MW)</FormLabel>
                    <FormControl><Input type="number" step="0.01" placeholder="0" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              )}
            </div>

            <HybridSumCheck form={form} hasWind={hasWind} hasSolar={hasSolar} hasBess={hasBess} />
          </div>
        )}

        {/* ── CONTD-4 Toggle ── */}
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <FormField control={form.control} name="createContd4" render={({ field }) => (
            <FormItem>
              <div className="flex items-center gap-3">
                <FormControl>
                  <Checkbox checked={field.value} onCheckedChange={field.onChange} id="createContd4" />
                </FormControl>
                <label htmlFor="createContd4" className="text-sm font-medium cursor-pointer">
                  Also create CONTD-4 application for this project
                </label>
              </div>
            </FormItem>
          )} />

          {watchedContd4 && (
            <div className="grid grid-cols-2 gap-4 pt-2">
              <FormField control={form.control} name="contd4.applicationDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Application Date *</FormLabel>
                  <FormControl>
                    <DatePicker value={field.value} onChange={field.onChange} placeholder="Pick application date" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="contd4.proposedFtcDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Proposed FTC Date</FormLabel>
                  <FormControl>
                    <DatePicker value={field.value} onChange={field.onChange} placeholder="Pick proposed date" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="contd4.capacityApr26Mw" render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-1.5 flex-wrap">
                    Capacity for
                    <select
                      value={form.watch('contd4.capacityMonth') ?? ''}
                      onChange={(e) => form.setValue('contd4.capacityMonth', e.target.value, { shouldValidate: true })}
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

              {/* Status: locked to PENDING for everyone except ADMIN/NLDC, who
                  may pick any status (typically CLEARED) when onboarding a
                  project that's already past CONTD-4. Server enforces the
                  same rule — non-ADMIN/NLDC requests are coerced to PENDING. */}
              <FormField control={form.control} name="contd4.status" render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Status
                    {canBackdate && (
                      <span className="text-[10px] text-muted-foreground font-normal ml-1">
                        (ADMIN/NLDC — pick CLEARED to onboard an already-approved project)
                      </span>
                    )}
                  </FormLabel>
                  {canBackdate ? (
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
                      <div className="h-10 flex items-center px-3 rounded-md border border-input bg-muted/30 text-sm text-foreground">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border bg-amber-50 text-amber-700 border-amber-200">
                          Pending
                        </span>
                        <span className="text-[10px] text-muted-foreground ml-2">— starts as Pending; update later from the project page</span>
                      </div>
                    </>
                  )}
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="contd4.remarks" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Remarks</FormLabel>
                  <FormControl>
                    <textarea
                      {...field}
                      rows={2}
                      placeholder="Any issues or notes..."
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
          )}
        </div>

        {canBackdate && (
          <div className="rounded-md border border-amber-200 bg-amber-50/40 p-4">
            <FormField control={form.control} name="effectiveDate" render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Effective Date{' '}
                  <span className="text-[10px] text-muted-foreground font-normal">
                    (ADMIN/NLDC — back-dates the project so it appears in historical snapshots)
                  </span>
                </FormLabel>
                <FormControl>
                  <DatePicker value={field.value} onChange={field.onChange} placeholder="Defaults to today" />
                </FormControl>
                <p className="text-[11px] text-muted-foreground">
                  Snapshots from this date forward will be rebuilt to include this project.
                </p>
                <FormMessage />
              </FormItem>
            )} />
          </div>
        )}

        <div className="flex gap-3 justify-end pt-2">
          <Button type="button" variant="outline" onClick={() => onCancel ? onCancel() : router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Creating...' : 'Create Project'}
          </Button>
        </div>
      </form>

      {/* ── Add Pooling Station mini-modal ── */}
      <Dialog open={addPsOpen} onOpenChange={setAddPsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Pooling Station</DialogTitle>
            <DialogDescription>
              The new station will be saved to the selected region.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            {addPsError && (
              <p className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">{addPsError}</p>
            )}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Station Name *</label>
              <Input
                placeholder="e.g. 400/220kV Hiriyur Pooling Station"
                value={newPsName}
                onChange={(e) => setNewPsName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Voltage (kV)</label>
              <Input
                type="number"
                placeholder="400"
                value={newPsVoltage}
                onChange={(e) => setNewPsVoltage(e.target.value)}
              />
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <Button type="button" variant="outline" size="sm" onClick={() => setAddPsOpen(false)}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={handleAddPs} disabled={addPsPending}>
                {addPsPending ? 'Saving...' : 'Add Station'}
              </Button>
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </Form>
  );
}

function HybridSumCheck({ form, hasWind, hasSolar, hasBess }) {
  const wind  = hasWind  ? (parseFloat(form.watch('windCapacityMw')  || '0') || 0) : 0;
  const solar = hasSolar ? (parseFloat(form.watch('solarCapacityMw') || '0') || 0) : 0;
  const bess  = hasBess  ? (parseFloat(form.watch('bessCapacityMw')  || '0') || 0) : 0;
  const total = parseFloat(form.watch('totalCapacityMw') || '0') || 0;
  const sum   = wind + solar + bess;
  const ok    = Math.abs(sum - total) < 0.01;

  if (!total || !sum) return null;

  return (
    <div className={`text-xs px-3 py-2 rounded-md ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
      {ok
        ? `✓ Component sum (${sum} MW) matches total capacity.`
        : `Component sum (${sum} MW) does not match total capacity (${total} MW). Difference: ${Math.abs(sum - total).toFixed(2)} MW.`}
    </div>
  );
}
