import { prisma } from '@/lib/prisma';
import { requireServerUser, buildRegionScope, activePeriodFilter, getUserRegion } from '@/lib/server-auth';
import { redirect } from 'next/navigation';
import { serialize } from '@/lib/serialize';
import { FtcPageClient } from '@/components/grid/FtcPageClient';

export const metadata = { title: 'FTC Tracker — FTC Portal' };

export default async function FtcPage({ searchParams }) {
  let user;
  try {
    user = await requireServerUser();
  } catch {
    redirect('/login');
  }

  // ── Point-in-time view ─────────────────────────────────────────────────────
  // ?asOf=YYYY-MM-DD restricts every dated read to the supplied cutoff. The
  // computation layer (lib/grid-computations) already sums per-event MW; here
  // we just need to filter the *queries* so events/phases after the cutoff
  // never load.
  const params  = await searchParams;
  const asOfStr = params?.asOf ?? null;
  const asOf    = asOfStr ? new Date(asOfStr + 'T23:59:59.999Z') : null;

  const scope = await buildRegionScope(user.role);

  const projects = await prisma.generationProject.findMany({
    where: {
      ...scope,
      // Wrapped in AND because activePeriodFilter(asOf) itself returns an
      // `OR` key — combining via two literal `OR` keys would clobber one.
      AND: [
        activePeriodFilter(asOf),
        // FTC pipeline membership is independent of CONTD-4: a project shows
        // here when entered directly into FTC (inFtcPipeline) OR when its
        // CONTD-4 cleared (the legacy bridge).
        { OR: [{ inFtcPipeline: true }, { contd4: { status: 'CLEARED' } }] },
      ],
    },
    include: {
      region:         true,
      plantType:      true,
      poolingStation: true,
      contd4: {
        include: {
          phases: {
            where: asOf ? { declaredDate: { lte: asOf } } : undefined,
            orderBy: { declaredDate: 'asc' },
          },
        },
      },
      phases: {
        orderBy: { createdAt: 'asc' },
        include: {
          ftcEvents: { where: asOf ? { eventDate: { lte: asOf } } : undefined, orderBy: { eventDate: 'asc' } },
          tocEvents: { where: asOf ? { eventDate: { lte: asOf } } : undefined, orderBy: { eventDate: 'asc' } },
          codEvents: { where: asOf ? { eventDate: { lte: asOf } } : undefined, orderBy: { eventDate: 'asc' } },
        },
      },
      notes:          { include: { user: true }, orderBy: { createdAt: 'desc' } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // For hybrids the per-component capacities (Wind/Solar/BESS/PSP) live in
  // hybridComponentsJson — the Excel's "Source wise Segregation" data.
  // Fall back to the explicit Decimal columns when present (legacy path).
  const componentCap = (p, src) => {
    const explicit = {
      WIND:  p.windCapacityMw, SOLAR: p.solarCapacityMw, BESS: p.bessCapacityMw,
    }[src];
    if (explicit != null) return Number(explicit);
    const comp = p.hybridComponentsJson?.components?.find((c) => c.sourceType === src);
    return comp ? Number(comp.totalMw) : null;
  };

  // Selector list for "Add Commissioning Phase" — ALL active projects in
  // scope, not just pipeline members. This is what lets a project be entered
  // directly into FTC: pick any project (even one whose CONTD-4 is still
  // pending or absent), record its FTC/TOC/COD data, and the action flags it
  // into the pipeline. Pipeline membership for the TABLE still uses the
  // scoped `projects` query above.
  const selectable = await prisma.generationProject.findMany({
    where: { ...scope, ...activePeriodFilter(asOf) },
    include: {
      region: true, plantType: true,
      contd4: { select: { status: true } },
      phases: true,
    },
    orderBy: { name: 'asc' },
  });
  const allCleared = serialize(
    selectable.map((p) => ({
      id:              p.id,
      name:            p.name,
      inFtcPipeline:   p.inFtcPipeline,
      contd4Status:    p.contd4?.status ?? null,
      totalCapacityMw: Number(p.totalCapacityMw),
      windCapacityMw:  componentCap(p, 'WIND'),
      solarCapacityMw: componentCap(p, 'SOLAR'),
      bessCapacityMw:  componentCap(p, 'BESS'),
      pspCapacityMw:   componentCap(p, 'PSP'),
      region:          p.region,
      plantType:       p.plantType,
      hybridComponentsJson: p.hybridComponentsJson ?? null,
      phases: p.phases.map((ph) => ({
        sourceType:        ph.sourceType,
        capacityAppliedMw: ph.capacityAppliedMw != null ? Number(ph.capacityAppliedMw) : null,
        ftcCompletedMw:    ph.ftcCompletedMw    != null ? Number(ph.ftcCompletedMw)    : null,
        tocIssuedMw:       ph.tocIssuedMw       != null ? Number(ph.tocIssuedMw)       : null,
        codDeclaredMw:     ph.codDeclaredMw     != null ? Number(ph.codDeclaredMw)     : null,
      })),
    }))
  );

  const enriched = serialize(
    projects.map((p) => ({
      ...p,
      totalCapacityMw:   Number(p.totalCapacityMw),
      windCapacityMw:    componentCap(p, 'WIND'),
      solarCapacityMw:   componentCap(p, 'SOLAR'),
      bessCapacityMw:    componentCap(p, 'BESS'),
      pspCapacityMw:     componentCap(p, 'PSP'),
      commissionedMw:    p.phases.reduce((s, ph) => s + Number(ph.codDeclaredMw ?? 0), 0),
      pendingCapacityMw: Number(p.totalCapacityMw) -
                         p.phases.reduce((s, ph) => s + Number(ph.codDeclaredMw ?? 0), 0),
      phases: p.phases.map((ph) => {
        const toc = ph.tocIssuedMw  != null ? Number(ph.tocIssuedMw)  : 0;
        const cod = ph.codDeclaredMw != null ? Number(ph.codDeclaredMw) : 0;
        const mapEvent = (e) => ({
          id: e.id,
          eventDate: e.eventDate,
          capacityMw: Number(e.capacityMw),
          remarks: e.remarks ?? null,
          // Audit trail — when this event row was last written by the
          // upsert. Preserved across edits when the event ID is sent back
          // through the form.
          createdAt: e.createdAt,
          updatedAt: e.updatedAt,
        });
        return {
          ...ph,
          capacityAppliedMw:  ph.capacityAppliedMw  != null ? Number(ph.capacityAppliedMw)  : null,
          ftcCompletedMw:     ph.ftcCompletedMw      != null ? Number(ph.ftcCompletedMw)      : null,
          tocIssuedMw:        toc,
          codDeclaredMw:      cod,
          capacityUnderFtcMw: ph.capacityUnderFtcMw  != null ? Number(ph.capacityUnderFtcMw)  : null,
          capacityUnderTocMw: ph.capacityUnderTocMw  != null ? Number(ph.capacityUnderTocMw)  : null,
          codPendingMw:       Math.max(0, toc - cod),
          expectedApr26Mw:    ph.expectedApr26Mw     != null ? Number(ph.expectedApr26Mw)     : null,
          // Preserve per-date events so the FTC tracker can show phased history
          ftcEvents: (ph.ftcEvents ?? []).map(mapEvent),
          tocEvents: (ph.tocEvents ?? []).map(mapEvent),
          codEvents: (ph.codEvents ?? []).map(mapEvent),
        };
      }),
    }))
  );

  const regionLabel = scope.regionId
    ? 'Showing projects for your region'
    : 'Showing all regions (NLDC/Admin view)';

  // Data for the inline "Create new generating station" path in the Add
  // Source/Component modal (mirrors /generation/new).
  const userRegion = await getUserRegion(user.role);
  const [regions, plantTypes, poolingStations, stations] = await Promise.all([
    prisma.gridRegion.findMany({ orderBy: { code: 'asc' } }),
    prisma.plantType.findMany({ orderBy: { label: 'asc' } }),
    prisma.poolingStation.findMany({ where: userRegion ? { regionId: userRegion.id } : undefined, orderBy: { name: 'asc' } }),
    prisma.generatingStation.findMany({
      where: userRegion ? { regionCode: userRegion.code } : undefined,
      select: { name: true, poolingStationName: true, regionCode: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  return (
    <FtcPageClient
      projects={enriched}
      allClearedProjects={allCleared}
      userRole={user.role}
      regionLabel={regionLabel}
      asOf={asOfStr}
      regions={serialize(regions)}
      plantTypes={serialize(plantTypes)}
      poolingStations={serialize(poolingStations)}
      stations={serialize(stations)}
      lockedRegionId={userRegion?.id ?? null}
    />
  );
}
