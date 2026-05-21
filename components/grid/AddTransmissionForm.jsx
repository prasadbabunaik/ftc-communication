'use client';

import { useState, useTransition, useRef, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createTransmissionSchema } from '@/lib/validations/grid';
import { createTransmissionElement, updateTransmissionElement } from '@/app/actions/grid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import { Alert, AlertIcon, AlertTitle } from '@/components/ui/alert';
import { GovLoader } from '@/components/ui/gov-loader';
import { AlertCircle } from 'lucide-react';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';

function toDateInput(val) {
  if (!val) return '';
  return new Date(val).toISOString().split('T')[0];
}

function AutoResizeTextarea({ value, onChange, className, ...props }) {
  const ref = useRef(null);
  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(() => { requestAnimationFrame(resize); }, [value]);
  return <textarea ref={ref} value={value} onChange={onChange} className={className} {...props} />;
}

export function AddTransmissionForm({ regions, lockedRegionId, element, userRole, onSuccess, onCancel }) {
  const isEdit = !!element;
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState(null);

  const canBackdate = isEdit && (userRole === 'ADMIN' || userRole === 'NLDC');
  const todayISO    = new Date().toISOString().slice(0, 10);

  const form = useForm({
    resolver: zodResolver(createTransmissionSchema),
    defaultValues: {
      regionId:          element?.regionId ?? lockedRegionId ?? '',
      agencyOwner:       element?.agencyOwner ?? '',
      elementName:       element?.elementName ?? '',
      elementType:       element?.elementType ?? 'LINE',
      isRe:              element?.isRe ?? false,
      voltageRatingKv:   element?.voltageRatingKv != null ? String(element.voltageRatingKv) : '',
      capacityMva:       element?.capacityMva != null ? String(element.capacityMva) : '',
      lineLengthKm:      element?.lineLengthKm != null ? String(element.lineLengthKm) : '',
      firstEnergyDate:   toDateInput(element?.firstEnergyDate),
      pendingFtc:        element?.pendingFtc ?? false,
      proposedFtcDate:   toDateInput(element?.proposedFtcDate),
      capacityApr26Mva:  element?.capacityApr26Mva != null ? String(element.capacityApr26Mva) : '',
      lineLengthApr26Km: element?.lineLengthApr26Km != null ? String(element.lineLengthApr26Km) : '',
      remarks:           element?.remarks ?? '',
      effectiveDate:     canBackdate ? todayISO : '',
    },
  });

  const watchedPending = form.watch('pendingFtc');

  function onSubmit(values) {
    setServerError(null);
    startTransition(async () => {
      const result = isEdit
        ? await updateTransmissionElement(element.id, values)
        : await createTransmissionElement(values);
      if (result?.error) {
        setServerError(typeof result.error === 'string' ? result.error : 'Please fix the errors and try again.');
        return;
      }
      onSuccess?.();
    });
  }

  return (
    <Form {...form}>
      {isPending && <GovLoader overlay size="page" theme="navy" label={isEdit ? 'Updating element…' : 'Saving element…'} sublabel="Please wait." />}

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {serverError && (
          <Alert variant="destructive">
            <AlertIcon><AlertCircle /></AlertIcon>
            <AlertTitle>{serverError}</AlertTitle>
          </Alert>
        )}

        {/* Identity */}
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <h2 className="font-semibold text-sm text-foreground">Element Details</h2>

          <div className="grid grid-cols-2 gap-4">
            <FormField control={form.control} name="regionId" render={({ field }) => (
              <FormItem>
                <FormLabel>Region *</FormLabel>
                <FormControl>
                  <select {...field} disabled={!!lockedRegionId && !isEdit}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60">
                    <option value="">Select region...</option>
                    {regions.map((r) => <option key={r.id} value={r.id}>{r.code} — {r.name}</option>)}
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="agencyOwner" render={({ field }) => (
              <FormItem>
                <FormLabel>Agency / Owner *</FormLabel>
                <FormControl><Input placeholder="e.g. PGCIL SR1, TGSTRANSCO" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>

          <FormField control={form.control} name="elementName" render={({ field }) => (
            <FormItem>
              <FormLabel>Element Name *</FormLabel>
              <FormControl><Input placeholder="e.g. 400kV Hiriyur-Tumkur D/C Line" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />

          <div className="grid grid-cols-3 gap-4">
            <FormField control={form.control} name="elementType" render={({ field }) => (
              <FormItem>
                <FormLabel>Type *</FormLabel>
                <FormControl>
                  <select {...field} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                    <option value="LINE">LINE</option>
                    <option value="ICT">ICT</option>
                    <option value="GT">GT</option>
                    <option value="ST">ST</option>
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="voltageRatingKv" render={({ field }) => (
              <FormItem>
                <FormLabel>Voltage (kV)</FormLabel>
                <FormControl><Input type="number" placeholder="400" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="isRe" render={({ field }) => (
              <FormItem className="flex flex-col justify-end pb-2">
                <div className="flex items-center gap-2">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} id="isRe" />
                  </FormControl>
                  <label htmlFor="isRe" className="text-sm font-medium cursor-pointer">RE (Renewable Energy)</label>
                </div>
              </FormItem>
            )} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField control={form.control} name="capacityMva" render={({ field }) => (
              <FormItem>
                <FormLabel>Capacity (MVA)</FormLabel>
                <FormControl><Input type="number" step="0.01" placeholder="500" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="lineLengthKm" render={({ field }) => (
              <FormItem>
                <FormLabel>Line Length (km)</FormLabel>
                <FormControl><Input type="number" step="0.001" placeholder="49.78" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField control={form.control} name="firstEnergyDate" render={({ field }) => (
              <FormItem>
                <FormLabel>First Energization Date</FormLabel>
                <FormControl>
                  <DatePicker value={field.value ?? ''} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="pendingFtc" render={({ field }) => (
              <FormItem className="flex flex-col justify-end pb-2">
                <div className="flex items-center gap-2">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} id="pendingFtc" />
                  </FormControl>
                  <label htmlFor="pendingFtc" className="text-sm font-medium cursor-pointer">Pending for FTC</label>
                </div>
              </FormItem>
            )} />
          </div>

          {watchedPending && (
            <FormField control={form.control} name="proposedFtcDate" render={({ field }) => (
              <FormItem>
                <FormLabel>Proposed FTC Date</FormLabel>
                <FormControl>
                  <DatePicker value={field.value ?? ''} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
          )}
        </div>

        {/* Targets */}
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <h2 className="font-semibold text-sm text-foreground">Commissioning Targets</h2>
          <div className="grid grid-cols-2 gap-4">
            <FormField control={form.control} name="capacityApr26Mva" render={({ field }) => (
              <FormItem>
                <FormLabel>Capacity to Commission (MVA)</FormLabel>
                <FormControl><Input type="number" step="0.01" placeholder="0" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="lineLengthApr26Km" render={({ field }) => (
              <FormItem>
                <FormLabel>Line Length to Commission (km)</FormLabel>
                <FormControl><Input type="number" step="0.001" placeholder="0" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>
          <FormField control={form.control} name="remarks" render={({ field }) => (
            <FormItem>
              <FormLabel>Remarks</FormLabel>
              <FormControl>
                <AutoResizeTextarea
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                  placeholder="Anti-theft charging from Vattem end..."
                  className="w-full min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring/30 placeholder:text-muted-foreground"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />

          {canBackdate && (
            <FormField control={form.control} name="effectiveDate" render={({ field }) => (
              <FormItem>
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

        <div className="flex gap-3 justify-end">
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Element'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
