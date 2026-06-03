'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, X, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { updateGenerationProject } from '@/app/actions/grid';

export function ProjectEditPanel({ project, poolingStations }) {
  const [open, setOpen]              = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const isHybrid = project.plantType?.isHybrid;

  const [name,      setName]      = useState(project.name ?? '');
  const [totalCap,  setTotalCap]  = useState(project.totalCapacityMw != null ? String(Number(project.totalCapacityMw)) : '');
  const [windCap,   setWindCap]   = useState(project.windCapacityMw  != null ? String(Number(project.windCapacityMw))  : '');
  const [solarCap,  setSolarCap]  = useState(project.solarCapacityMw != null ? String(Number(project.solarCapacityMw)) : '');
  const [bessCap,   setBessCap]   = useState(project.bessCapacityMw  != null ? String(Number(project.bessCapacityMw))  : '');
  const [psId,      setPsId]      = useState(project.poolingStationId ?? '');

  function handleSubmit(e) {
    e.preventDefault();
    startTransition(async () => {
      const result = await updateGenerationProject(project.id, {
        name, poolingStationId: psId,
        totalCapacityMw: totalCap,
        windCapacityMw: windCap, solarCapacityMw: solarCap, bessCapacityMw: bessCap,
      });
      if (result?.error) {
        toast.error(typeof result.error === 'string' ? result.error : 'Update failed.');
      } else {
        toast.success('Project updated.');
        setOpen(false);
        router.refresh();
      }
    });
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Pencil className="size-3.5 mr-1.5" />
        Edit Project
      </Button>
    );
  }

  return (
    <div className="rounded-xl border bg-card shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">Edit Project Details</h3>
        <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground p-1 rounded">
          <X className="size-4" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Generating Station Name *</label>
            <input
              required
              value={name}
              onChange={e => setName(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Total Capacity (MW) *</label>
            <input
              required type="number" step="0.01"
              value={totalCap}
              onChange={e => setTotalCap(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Pooling Station</label>
            <select
              value={psId}
              onChange={e => setPsId(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
            >
              <option value="">— None —</option>
              {poolingStations.map(ps => (
                <option key={ps.id} value={ps.id}>{ps.name}</option>
              ))}
            </select>
          </div>
          {isHybrid && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Wind Capacity (MW)</label>
                <input type="number" step="0.01" value={windCap} onChange={e => setWindCap(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Solar Capacity (MW)</label>
                <input type="number" step="0.01" value={solarCap} onChange={e => setSolarCap(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">BESS Capacity (MW)</label>
                <input type="number" step="0.01" value={bessCap} onChange={e => setBessCap(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30" />
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1 border-t">
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={isPending}>
            <Save className="size-3.5 mr-1.5" />
            {isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </div>
  );
}
