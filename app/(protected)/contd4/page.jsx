import { prisma } from '@/lib/prisma';
import { requireServerUser, buildRegionScope, getUserRegion, activePeriodFilter } from '@/lib/server-auth';
import { redirect } from 'next/navigation';
import { serialize } from '@/lib/serialize';
import { Contd4PageClient } from '@/components/grid/Contd4PageClient';

export const metadata = { title: 'CONTD-4 Applications — FTC Portal' };

export default async function Contd4Page({ searchParams }) {
  let user;
  try {
    user = await requireServerUser();
  } catch {
    redirect('/login');
  }

  // ── Date filter ────────────────────────────────────────────────────────────
  // ?asOf=YYYY-MM-DD lets the user inspect the CONTD-4 list as it stood on
  // a past date. The filter relies on active-period columns + per-phase
  // declaredDate so the snapshot includes:
  //   - only projects live on that date (activeFrom <= asOf < activeUntil)
  //   - only phases declared on or before that date
  const params  = await searchParams;
  const asOfStr = params?.asOf ?? null;
  const asOf    = asOfStr ? new Date(asOfStr + 'T23:59:59.999Z') : null;

  const scope = await buildRegionScope(user.role);

  const [projects, regions, plantTypes, userRegion] = await Promise.all([
    prisma.generationProject.findMany({
      where: { ...scope, ...activePeriodFilter(asOf) },
      include: {
        region:         true,
        plantType:      true,
        poolingStation: true,
        contd4: {
          include: {
            phases: {
              // Hide phases declared after the asOf cutoff so the view
              // shows the project as it stood on the requested date.
              where: asOf ? { declaredDate: { lte: asOf } } : undefined,
              orderBy: { declaredDate: 'asc' },
            },
          },
        },
        phases:         { orderBy: { createdAt: 'asc' } },
        notes:          { include: { user: true }, orderBy: { createdAt: 'desc' } },
        // Attachment metadata only — never the `data` bytea, which would bloat
        // the page payload. The file bytes are fetched on demand via the
        // /api/grid/contd4-attachments/[id] route.
        attachments: {
          select: {
            id: true, filename: true, mimeType: true, sizeBytes: true,
            remarks: true, createdAt: true,
            uploadedBy: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.gridRegion.findMany({ orderBy: { code: 'asc' } }),
    prisma.plantType.findMany({ orderBy: { label: 'asc' } }),
    getUserRegion(user.role),
  ]);

  const poolingStations = await prisma.poolingStation.findMany({
    where: userRegion ? { regionId: userRegion.id } : undefined,
    orderBy: { name: 'asc' },
  });

  // Master generating-station list for the searchable station-name dropdown.
  // RLDC users only see stations in their region.
  const stations = await prisma.generatingStation.findMany({
    where: userRegion ? { regionCode: userRegion.code } : undefined,
    select: { name: true, poolingStationName: true, regionCode: true },
    orderBy: { name: 'asc' },
  });

  // ── Snapshot-accurate status (as-of-date) ──────────────────────────────────
  // CONTD-4 applications always start in UNDER_PROCESS. Every subsequent status
  // change (RECEIVED / REJECTED / CLEARED) is logged to `project_notes` with
  // field='Status', oldValue, newValue, createdAt. We can therefore replay
  // those logs to compute the status as it was on `asOf` without needing a
  // dedicated history table.
  //   • Find the most recent project_notes entry with field='Status' AND
  //     createdAt <= asOf for each project.
  //   • Use that note's `newValue` as the historical status.
  //   • If no such note exists, the application was still at its initial
  //     status (UNDER_PROCESS).
  function statusAsOf(p) {
    if (!asOf) return p.contd4?.status ?? null;
    if (!p.contd4) return null;
    const cutoff = asOf.getTime();
    // Honour back-dated changes: effectiveDate (when ADMIN/NLDC supplied one)
    // overrides createdAt for point-in-time replay.
    const eff = (n) => new Date(n.effectiveDate ?? n.createdAt).getTime();
    const statusChange = (p.notes ?? [])
      .filter((n) => n.field === 'Status' && eff(n) <= cutoff)
      .sort((a, b) => eff(b) - eff(a))[0];
    return statusChange?.newValue ?? 'UNDER_PROCESS';
  }

  const enriched = serialize(
    projects.map((p) => {
      const histStatus = statusAsOf(p);
      const contd4 = p.contd4
        ? {
            ...p.contd4,
            // Override status with the snapshot value when an asOf date is set.
            status: histStatus ?? p.contd4.status,
          }
        : null;
      return {
        ...p,
        contd4,
        totalCapacityMw:   Number(p.totalCapacityMw),
        commissionedMw:    p.phases.reduce((s, ph) => s + Number(ph.codDeclaredMw ?? 0), 0),
        pendingCapacityMw: Number(p.totalCapacityMw) -
                           p.phases.reduce((s, ph) => s + Number(ph.codDeclaredMw ?? 0), 0),
      };
    })
  );

  const regionLabel = scope.regionId
    ? 'Showing projects for your region'
    : 'Showing all regions (NLDC/Admin view)';

  return (
    <Contd4PageClient
      projects={enriched}
      regions={serialize(regions)}
      plantTypes={serialize(plantTypes)}
      poolingStations={serialize(poolingStations)}
      stations={serialize(stations)}
      lockedRegionId={userRegion?.id ?? null}
      userRole={user.role}
      regionLabel={regionLabel}
      asOf={asOfStr}
    />
  );
}
