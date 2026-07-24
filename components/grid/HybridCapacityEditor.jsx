'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Pencil, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { updateHybridComponents } from '@/app/actions/grid';

// Only Wind/Solar/BESS have per-source capacity columns, so those are the
// editable components. A hybrid built purely from these can be edited; hybrids
// that include PSP/Hydro/Coal (no capacity column) render read-only.
const WSB_EDITABLE_CODES = ['HYBRID_WS', 'HYBRID_SB', 'HYBRID_WB', 'HYBRID_WSB'];
const COMPONENTS = [
  { key: 'wind',  label: 'Wind',  field: 'windCapacityMw' },
  { key: 'solar', label: 'Solar', field: 'solarCapacityMw' },
  { key: 'bess',  label: 'BESS',  field: 'bessCapacityMw' },
];

const fmt = (v) => (v == null ? null : Number(v).toFixed(1));

export function HybridCapacityEditor({ project, canEdit }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState({
    wind:  project.windCapacityMw  != null ? String(Number(project.windCapacityMw))  : '',
    solar: project.solarCapacityMw != null ? String(Number(project.solarCapacityMw)) : '',
    bess:  project.bessCapacityMw  != null ? String(Number(project.bessCapacityMw))  : '',
  });

  const editable = canEdit && WSB_EDITABLE_CODES.includes(project.plantType.code);
  const present = COMPONENTS.filter((c) => project[c.field] != null);

  const sum = COMPONENTS.reduce((s, c) => s + (parseFloat(form[c.key]) || 0), 0);
  const enteredCount = COMPONENTS.filter((c) => (parseFloat(form[c.key]) || 0) > 0).length;

  function reset() {
    setForm({
      wind:  project.windCapacityMw  != null ? String(Number(project.windCapacityMw))  : '',
      solar: project.solarCapacityMw != null ? String(Number(project.solarCapacityMw)) : '',
      bess:  project.bessCapacityMw  != null ? String(Number(project.bessCapacityMw))  : '',
    });
    setEditing(false);
  }

  function save() {
    if (enteredCount === 0) { toast.error('Enter at least one component capacity greater than zero.'); return; }
    startTransition(async () => {
      const result = await updateHybridComponents(project.id, form);
      if (result?.error) { toast.error(result.error); return; }
      toast.success(`Hybrid capacities updated${result.plantTypeLabel ? ` · ${result.plantTypeLabel}` : ''}.`);
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Hybrid Capacity Breakdown
        </p>
        {editable && !editing && (
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-md px-2 py-1 transition-colors"
          >
            <Pencil className="size-3.5" /> Edit
          </button>
        )}
      </div>

      {!editing ? (
        <div className="flex gap-8">
          {present.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No component capacities recorded.</p>
          ) : (
            present.map((c) => (
              <div key={c.key}>
                <p className="text-xs text-muted-foreground">{c.label}</p>
                <p className="font-semibold text-sm">{fmt(project[c.field])} MW</p>
              </div>
            ))
          )}
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-3 gap-3">
            {COMPONENTS.map((c) => (
              <div key={c.key}>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">{c.label} (MW)</p>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0 — leave blank to omit"
                  value={form[c.key]}
                  onChange={(e) => setForm((f) => ({ ...f, [c.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Enter a capacity to add a component; clear it to remove one. Total capacity and the plant type
            (e.g. Hybrid (Solar+BESS)) are recalculated from the components entered.
            <span className={`ml-2 font-semibold ${sum > 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
              New total: {sum.toFixed(1)} MW
            </span>
          </p>
          <div className="flex justify-end gap-2 mt-3">
            <Button type="button" variant="outline" size="sm" onClick={reset} disabled={isPending}>
              <X className="size-3.5 mr-1.5" /> Cancel
            </Button>
            <Button type="button" size="sm" onClick={save} disabled={isPending}>
              <Check className="size-3.5 mr-1.5" /> {isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
