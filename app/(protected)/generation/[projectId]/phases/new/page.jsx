import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { requireServerUser, buildRegionScope } from '@/lib/server-auth';
import { ArrowLeft } from 'lucide-react';
import { AddPhasesForm } from '@/components/grid/AddPhasesForm';
import { serialize } from '@/lib/serialize';

export const metadata = { title: 'Add Commissioning Phase — FTC Portal' };

export default async function AddPhasePage({ params }) {
  let user;
  try {
    user = await requireServerUser();
  } catch {
    redirect('/login');
  }

  const canEdit = ['ADMIN', 'SRLDC', 'NRLDC', 'ERLDC', 'WRLDC', 'NERLDC'].includes(user.role);
  if (!canEdit) redirect('/generation');

  const { projectId } = await params;

  const project = await prisma.generationProject.findUnique({
    where: { id: projectId },
    include: {
      region:    true,
      plantType: true,
      phases:    {
        select: {
          sourceType:        true,
          capacityAppliedMw: true,
          ftcCompletedMw:    true,
          tocIssuedMw:       true,
          codDeclaredMw:     true,
        },
      },
    },
  });

  if (!project) notFound();

  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== project.regionId) {
    redirect('/generation');
  }

  const existingCodMw = project.phases.reduce((s, p) => s + Number(p.codDeclaredMw ?? 0), 0);

  const sourceUsed = project.phases.reduce((acc, p) => {
    acc[p.sourceType] = (acc[p.sourceType] ?? 0) + Number(p.capacityAppliedMw);
    return acc;
  }, {});

  // Serialise to plain numbers so client component can compute existing pipeline
  const existingPhases = project.phases.map((p) => ({
    sourceType:        p.sourceType,
    capacityAppliedMw: Number(p.capacityAppliedMw),
    ftcCompletedMw:    Number(p.ftcCompletedMw ?? 0),
    tocIssuedMw:       Number(p.tocIssuedMw    ?? 0),
    codDeclaredMw:     Number(p.codDeclaredMw  ?? 0),
  }));

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href={`/generation/${projectId}`} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-foreground">Add Commissioning Phase</h1>
          <p className="text-sm text-muted-foreground">
            {project.name} · {project.region.code} · {project.plantType.label}
          </p>
        </div>
      </div>

      <AddPhasesForm
        projectId={projectId}
        totalCapacityMw={Number(project.totalCapacityMw)}
        existingCodMw={existingCodMw}
        plantType={serialize(project.plantType)}
        isIntrastate={!!project.isIntrastate}
        windCapacityMw={project.windCapacityMw ? Number(project.windCapacityMw) : null}
        solarCapacityMw={project.solarCapacityMw ? Number(project.solarCapacityMw) : null}
        bessCapacityMw={project.bessCapacityMw ? Number(project.bessCapacityMw) : null}
        existingPhases={existingPhases}
        sourceUsed={sourceUsed}
        userRole={user.role}
      />
    </div>
  );
}
