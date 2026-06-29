import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { requireServerUser, buildRegionScope } from '@/lib/server-auth';
import { Plus, ArrowLeft, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProjectPhaseTimeline } from '@/components/grid/ProjectPhaseTimeline';
import { Contd4Card } from '@/components/grid/Contd4Card';
import { AuditFeed } from '@/components/grid/AuditFeed';
import { ProjectEditPanel } from '@/components/grid/ProjectEditPanel';
import { serialize } from '@/lib/serialize';
import { milestoneAsOf } from '@/lib/grid-computations';

export async function generateMetadata({ params }) {
  const { projectId } = await params;
  const project = await prisma.generationProject.findUnique({
    where: { id: projectId },
    select: { name: true },
  });
  return { title: project ? `${project.name} — FTC Portal` : 'Project Not Found' };
}

export default async function ProjectDetailPage({ params }) {
  let user;
  try {
    user = await requireServerUser();
  } catch {
    redirect('/login');
  }

  const { projectId } = await params;

  const project = await prisma.generationProject.findUnique({
    where: { id: projectId },
    include: {
      region:        true,
      plantType:     true,
      poolingStation: true,
      contd4:        { include: { phases: { orderBy: { declaredDate: 'asc' } } } },
      phases:        {
        orderBy: { createdAt: 'asc' },
        include: {
          notes: {
            include: { user: { select: { name: true } } },
            orderBy: { createdAt: 'asc' },
          },
          ftcEvents: { orderBy: { eventDate: 'asc' } },
          tocEvents: { orderBy: { eventDate: 'asc' } },
          codEvents: { orderBy: { eventDate: 'asc' } },
        },
      },
      notes:         {
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
      },
      createdBy:     { select: { name: true } },
    },
  });

  if (!project) notFound();

  // Check region scope
  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== project.regionId) {
    redirect('/generation');
  }

  const canEdit = ['ADMIN', 'NLDC', 'SRLDC', 'NRLDC', 'ERLDC', 'WRLDC', 'NERLDC'].includes(user.role);

  // Serialize all Prisma types before passing to Client Components
  const serializedProject = serialize(project);

  // Fetch pooling stations for this region (for the edit form)
  const poolingStations = canEdit ? await prisma.poolingStation.findMany({
    where: { regionId: project.regionId },
    orderBy: { name: 'asc' },
  }) : [];

  // Enrich with calculated fields
  // Date-gate COD the same way the dashboard / FTC tracker do (milestoneAsOf):
  // a future-dated COD event must not count as commissioned yet. Keeps this
  // page's "% complete" consistent with every other surface.
  const commissionedMw    = serializedProject.phases.reduce((s, p) => s + milestoneAsOf(p.codEvents, null, p.codDeclaredDate, p.codDeclaredMw), 0);
  const pendingCapacityMw = serializedProject.totalCapacityMw - commissionedMw;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link href="/generation" className="mt-0.5 text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="size-5" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-foreground">{serializedProject.name}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                {serializedProject.region.code}
              </span>
              <span className="text-xs text-muted-foreground">{serializedProject.plantType.label}</span>
              {serializedProject.poolingStation && (
                <span className="text-xs text-muted-foreground">· {serializedProject.poolingStation.name}</span>
              )}
              <span className="text-xs text-muted-foreground">
                · Added by {serializedProject.createdBy.name}
              </span>
            </div>
          </div>
        </div>

        {canEdit && (
          <div className="flex items-center gap-2">
            <ProjectEditPanel project={serializedProject} poolingStations={poolingStations} />
            <Button asChild size="sm">
              <Link href={`/generation/${projectId}/phases/new`}>
                <Plus className="size-4 mr-1.5" />
                Add Phase
              </Link>
            </Button>
          </div>
        )}
      </div>

      {/* Capacity Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <SummaryCard
          label="Total Capacity"
          value={`${serializedProject.totalCapacityMw.toFixed(1)} MW`}
          sub={serializedProject.plantType.label}
          color="blue"
        />
        <SummaryCard
          label="Commissioned (COD)"
          value={`${commissionedMw.toFixed(1)} MW`}
          sub={`${Math.round((commissionedMw / serializedProject.totalCapacityMw) * 100)}% complete`}
          color="emerald"
        />
        <SummaryCard
          label="Pending COD"
          value={`${Math.max(0, pendingCapacityMw).toFixed(1)} MW`}
          sub={pendingCapacityMw <= 0 ? 'Fully commissioned' : 'Remaining'}
          color={pendingCapacityMw <= 0 ? 'emerald' : 'amber'}
        />
      </div>

      {/* Hybrid breakdown */}
      {serializedProject.plantType.isHybrid && (
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Hybrid Capacity Breakdown</p>
          <div className="flex gap-6">
            {serializedProject.windCapacityMw  && <BreakdownItem label="Wind"  mw={serializedProject.windCapacityMw}  />}
            {serializedProject.solarCapacityMw && <BreakdownItem label="Solar" mw={serializedProject.solarCapacityMw} />}
            {serializedProject.bessCapacityMw  && <BreakdownItem label="BESS"  mw={serializedProject.bessCapacityMw}  />}
          </div>
        </div>
      )}

      {/* CONTD-4 Card */}
      <Contd4Card contd4={serializedProject.contd4} projectId={projectId} canEdit={canEdit} />

      {/* Phases Timeline */}
      <div>
        <h2 className="text-base font-semibold text-foreground mb-3">Commissioning Phases</h2>
        {serializedProject.phases.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-muted/10 p-10 text-center">
            <Zap className="size-8 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No commissioning phases yet.</p>
            {canEdit && (
              <Button asChild size="sm" className="mt-4">
                <Link href={`/generation/${projectId}/phases/new`}>Add First Phase</Link>
              </Button>
            )}
          </div>
        ) : (
          <ProjectPhaseTimeline
            phases={serializedProject.phases}
            projectId={projectId}
            canEdit={canEdit}
          />
        )}
      </div>

      {/* Project-level audit feed */}
      <div>
        <h2 className="text-base font-semibold text-foreground mb-3">Activity &amp; Change History</h2>
        <AuditFeed
          projectId={projectId}
          notes={serializedProject.notes ?? []}
          canAdd={canEdit}
        />
      </div>
    </div>
  );
}

function SummaryCard({ label, value, sub, color }) {
  const colors = {
    blue:   'bg-blue-50 border-blue-100',
    emerald: 'bg-emerald-50 border-emerald-100',
    amber:  'bg-amber-50 border-amber-100',
  };
  const textColors = {
    blue:   'text-blue-700',
    emerald: 'text-emerald-700',
    amber:  'text-amber-700',
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <p className="text-xs text-muted-foreground font-medium">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${textColors[color]}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
    </div>
  );
}

function BreakdownItem({ label, mw }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold text-sm">{Number(mw).toFixed(1)} MW</p>
    </div>
  );
}
