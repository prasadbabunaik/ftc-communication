import { prisma } from '@/lib/prisma';
import { requireServerUser, buildRegionScope, activePeriodFilter } from '@/lib/server-auth';
import { redirect } from 'next/navigation';
import { SummaryPageClient } from '@/components/grid/SummaryPageClient';
import {
  n,
  computePipelineMatrix, buildPipelineRows,
  computeContd4Study, computeTransmission,
  computeHybridBreakdown, computeMilestoneActivity, computeHybridComponentBreakup,
  getProjectSource, SOURCE_ORDER, isProjectCommissioned,
} from '@/lib/grid-computations';

// Returns ISO date strings (YYYY-MM-DD, UTC) for every day strictly between
// `fromIso` (exclusive) and `toIso` (inclusive). Used to backfill snapshots
// for any calendar day that doesn't have one — so "yesterday vs today" is
// always a meaningful comparison.
function datesBetween(fromIso, toIso) {
  const out = [];
  const start = new Date(fromIso + 'T00:00:00Z');
  const end   = new Date(toIso   + 'T00:00:00Z');
  for (let d = new Date(start.getTime() + 86400000); d <= end; d = new Date(d.getTime() + 86400000)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export const metadata = { title: 'Dashboard — FTC Portal' };

export default async function DashboardPage({ searchParams }) {
  let user;
  try { user = await requireServerUser(); }
  catch { redirect('/login'); }

  const params    = await searchParams;
  const asOfStr   = params.asOf   ?? null;
  const asOf      = asOfStr ? new Date(asOfStr) : null;

  // Milestone-activity date range (FTC/TOC/COD Activity tab). `from`/`to` are
  // YYYY-MM-DD. Default: current month 1st → today.
  const now = new Date();
  const defaultFrom = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const defaultTo   = now.toISOString().slice(0, 10);
  const activityFromStr = params.from ?? defaultFrom;
  const activityToStr   = params.to   ?? defaultTo;
  const activityFrom = new Date(activityFromStr + 'T00:00:00.000Z');
  const activityTo   = new Date(activityToStr   + 'T23:59:59.999Z');
  // For point-in-time computation: live view uses today (end of day), historical
  // uses the picked date (end of day). This keeps the live display in sync with
  // today's stored snapshot, and gives a stable snapshot series.
  const computeAsOf = (asOf ? new Date(asOfStr + 'T23:59:59.999Z') : (() => {
    const t = new Date(); t.setUTCHours(23, 59, 59, 999); return t;
  })());

  const baseScope = await buildRegionScope(user.role);

  // Region filter (ADMIN / NLDC only). RLDC users are already locked to their
  // own region by buildRegionScope, so the ?region param is ignored for them.
  // ADMIN/NLDC default to All India and can narrow to one region via the
  // header dropdown.
  const allRegions    = await prisma.gridRegion.findMany({ orderBy: { code: 'asc' }, select: { id: true, code: true, name: true } });
  const isRegionLocked = !!baseScope.regionId;

  // Filters are multi-select: comma-separated codes in the URL (?region=ER,NR).
  const parseCsv = (v) => (v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : []);

  const selectedRegions = !isRegionLocked
    ? parseCsv(params.region).filter(c => allRegions.some(r => r.code === c))
    : [];
  const selectedRegionIds = selectedRegions.map(c => allRegions.find(r => r.code === c).id);

  // For RLDC users the region is locked. Restrict the table scaffolds AND the
  // Activity-tab columns to that single region so the other regions aren't
  // rendered as empty all-zero rows/columns (the data is already scoped — this
  // just stops the scaffold from drawing them).
  const lockedRegionCode = isRegionLocked
    ? (allRegions.find(r => r.id === baseScope.regionId)?.code ?? null)
    : null;
  const effectiveRegions = isRegionLocked
    ? [lockedRegionCode].filter(Boolean)
    : selectedRegions;

  const scope = isRegionLocked
    ? baseScope
    : (selectedRegionIds.length ? { regionId: { in: selectedRegionIds } } : {});

  // Source filter (all roles). Narrows the generation tabs to the chosen source
  // bucket(s), matching how the pipeline tables categorise each project
  // (getProjectSource — hybrids bucket as HYBRID). Applied in JS post-query
  // since "source" is computed, not a column. Transmission is unaffected.
  const selectedSources = parseCsv(params.source).filter(c => SOURCE_ORDER.includes(c));

  // Hybrid-parts sub-filter (?hybridParts=WIND,SOLAR). Independent of the main
  // source filter: it only narrows which constituent sub-rows appear when a
  // HYBRID row is expanded in the FTC Pipeline. Validated against SOURCE_ORDER.
  const selectedHybridParts = parseCsv(params.hybridParts).filter(c => SOURCE_ORDER.includes(c));

  // Restrict to projects/elements that were "live" on the requested date.
  // With no asOf, this becomes `activeUntil IS NULL` — i.e. currently-active.
  const activeFilter = activePeriodFilter(asOf);

  const [projects, txElements, snapshots] = await Promise.all([
    prisma.generationProject.findMany({
      where: { ...scope, ...activeFilter },
      include: {
        region: true,
        plantType: true,
        contd4: { include: { phases: { orderBy: { declaredDate: 'asc' } } } },
        // Include per-date events so the pipeline compute can give accurate
        // point-in-time totals when an `asOf` is selected.
        phases: { include: { ftcEvents: true, tocEvents: true, codEvents: true } },
        poolingStation: true,
      },
    }),
    prisma.transmissionElement.findMany({
      where: { ...scope, ...activeFilter },
      include: { region: true },
    }),
    // Snapshots drive the "As on date" picker and the last-changes summary.
    prisma.gridSnapshot.findMany({
      select: { id: true, snapshotDate: true, label: true },
      orderBy: { snapshotDate: 'asc' },
    }),
  ]);

  // Generation tabs read from the source-filtered set; transmission does not.
  const viewProjects = selectedSources.length
    ? projects.filter((p) => selectedSources.includes(getProjectSource(p)))
    : projects;

  // Filters that narrow the table scaffolds to the selected axis (so filtering
  // removes non-matching rows instead of merely zeroing them).
  const filters = { regions: effectiveRegions, sources: selectedSources };

  // Activity tab: when HYBRID is selected alongside specific sources, restrict
  // each hybrid's component rows to those sources (Solar+Hybrid → only the
  // Solar component of each hybrid). HYBRID alone (empty list) → show every
  // component.
  const componentSources = selectedSources.includes('HYBRID')
    ? selectedSources.filter((s) => s !== 'HYBRID')
    : [];

  // Exclude-basis matrix (source-filtered) — feeds the six top stat cards so
  // they stay stable regardless of the hybrid toggle.
  const pipelineMatrix   = computePipelineMatrix(viewProjects, computeAsOf);
  // "Including / Excluding Hybrid" bifurcation (?hybrid=incl), now applied to
  // the FTC Pipeline, Source-wise and FTC/TOC/COD Activity tabs.
  // Excluding (default): hybrids sit in their own HYBRID row.
  // Including: each hybrid's per-component figures fold into its source bucket —
  // so e.g. WIND carries pure-wind plus the wind component of every hybrid, and
  // the (now-empty) HYBRID row is dropped. The folded matrix is built from the
  // FULL region-scoped set (not source-filtered) so hybrids aren't dropped
  // before folding; buildPipelineRows then narrows to the selected source(s).
  const hybridMode = params.hybrid === 'incl' ? 'incl' : 'excl';

  // "Exclude Commissioned" (?excludeCommissioned=1) — a view filter on the FTC
  // Pipeline / Source-wise tables that drops fully-commissioned projects so only
  // the still-under-process pipeline remains. Scoped to those tables + their
  // hybrid breakup; the top stat cards keep the full totals (they stay stable).
  const excludeCommissioned = params.excludeCommissioned === '1';
  const dropCommissioned = (list) =>
    excludeCommissioned ? list.filter((p) => !isProjectCommissioned(p)) : list;
  const tableViewProjects = dropCommissioned(viewProjects); // source-filtered set
  const tableAllProjects  = dropCommissioned(projects);     // full set (for hybrid fold/breakup)

  const pipelineMatrixForTables = hybridMode === 'incl'
    ? computePipelineMatrix(tableAllProjects, computeAsOf, { foldHybridComponents: true })
    : (excludeCommissioned ? computePipelineMatrix(tableViewProjects, computeAsOf) : pipelineMatrix);
  const tableFilters = hybridMode === 'incl' ? { ...filters, excludeHybrid: true } : filters;
  const table2Rows       = buildPipelineRows(pipelineMatrixForTables, 'region', 'source', tableFilters);
  const table5Rows       = buildPipelineRows(pipelineMatrixForTables, 'source', 'region', tableFilters);
  const contd4Study      = computeContd4Study(viewProjects, filters);
  const transmissionRows = computeTransmission(txElements);
  // Hybrid Breakdown ignores the source filter (its picker is disabled on that
  // tab) — the table is inherently scoped to hybrid projects, so region is the
  // only meaningful axis. Uses the unfiltered project set.
  const hybridRows       = computeHybridBreakdown(projects, computeAsOf);
  // Per-region hybrid component split — drives the expandable breakup under each
  // HYBRID row in the FTC-pipeline table (Grouped mode). Honours "Exclude
  // Commissioned" so the bifurcation matches the (filtered) HYBRID rows above it.
  const hybridBreakup    = computeHybridComponentBreakup(tableAllProjects, computeAsOf);
  // Distinct constituent sources actually present across all hybrids — populates
  // the Hybrid-Parts picker so it only ever offers components that exist. Kept in
  // canonical SOURCE_ORDER for stable UI ordering.
  const availableHybridParts = SOURCE_ORDER.filter(src =>
    Object.values(hybridBreakup).some(rows =>
      (rows ?? []).some(c => c.source === src && (c.totalCapacityMw > 0 || c.appliedMw > 0))));

  // BESS Data tab: plain BESS plants + hybrids carrying a BESS component +
  // intra-state storage. Like the hybrid tab it ignores the source filter
  // (the tab is source-specific already); region scope still applies.
  const bessProjects = projects.filter((p) =>
    p.isIntrastate ||
    p.plantType?.code === 'BESS' ||
    (p.plantType?.isHybrid && (
      (p.hybridComponentsJson?.components ?? []).some((c) => c.sourceType === 'BESS') ||
      (p.phases ?? []).some((ph) => ph.sourceType === 'BESS')
    ))
  );
  // Activity tab honours the same hybrid bifurcation. Including: fold hybrid
  // components into their source rows (from the full set so source-filtered
  // hybrids aren't dropped) and constrain totals to the selected sources.
  const activity         = hybridMode === 'incl'
    ? computeMilestoneActivity(projects, activityFrom, activityTo, [], { foldHybridComponents: true, sources: selectedSources })
    : computeMilestoneActivity(viewProjects, activityFrom, activityTo, componentSources);

  // Stat-card totals reuse the same milestone aggregation as the pipeline
  // matrix — sum across cells so values are consistent with the tables below.
  const totalApplied  = Object.values(pipelineMatrix).reduce((s, r) => s + n(r.appliedMw),     0);
  const totalFtc      = Object.values(pipelineMatrix).reduce((s, r) => s + n(r.ftcApprovedMw),  0);
  const totalToc      = Object.values(pipelineMatrix).reduce((s, r) => s + n(r.tocIssuedMw),    0);
  const totalCod      = Object.values(pipelineMatrix).reduce((s, r) => s + n(r.codCompletedMw), 0);
  const contd4Active  = viewProjects.filter(p => p.contd4 && !['CLEARED', 'REJECTED'].includes(p.contd4.status)).length;
  const txPending     = txElements.filter(e => e.pendingFtc).length;

  const regionLabel = isRegionLocked
    ? 'Showing your region'
    : (selectedRegions.length === 1
        ? `${allRegions.find(r => r.code === selectedRegions[0]).name} (${selectedRegions[0]})`
        : selectedRegions.length > 1
          ? `${selectedRegions.join(', ')} (${selectedRegions.length} regions)`
          : 'All India view');

  // Auto-upsert today's snapshot on every live page load. Also backfill any
  // missing day between the most recent stored snapshot and today, so
  // "yesterday vs today" is always a meaningful comparison even if no one
  // viewed the dashboard on those intermediate days.
  //
  // CRITICAL: snapshots are GLOBAL data — every viewer must compare against
  // the same time-series. If we wrote the snapshot using the current viewer's
  // region-scoped `projects` array, an RLDC visit would overwrite today's
  // snapshot with single-region data and an admin viewing the next day would
  // see a phantom "everything disappeared" diff. So here we always re-query
  // WITHOUT the region scope (only the activeFilter is kept) to build the
  // snapshot payload. The user's region-scoped view above is unaffected.
  let snapshotsList = snapshots;
  if (!asOf) {
    try {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const todayStr = today.toISOString().slice(0, 10);

      const [allProjects, allTxElements] = await Promise.all([
        prisma.generationProject.findMany({
          where: activeFilter,
          include: {
            region: true,
            plantType: true,
            contd4: { include: { phases: { orderBy: { declaredDate: 'asc' } } } },
            phases: { include: { ftcEvents: true, tocEvents: true, codEvents: true } },
          },
        }),
        prisma.transmissionElement.findMany({
          where: activeFilter,
          include: { region: true },
        }),
      ]);

      const globalPipelineMatrix = computePipelineMatrix(allProjects, computeAsOf);
      const globalContd4         = computeContd4Study(allProjects);
      const globalTransmission   = computeTransmission(allTxElements);
      const { rows: c4Rows, allMonths: c4Months } = globalContd4;

      // Backfill missing calendar days between the most-recent snapshot BEFORE
      // today and today, so "yesterday vs today" is always available.
      const priorSnaps = snapshotsList.filter(s => s.snapshotDate.toISOString().slice(0, 10) < todayStr);
      const lastPriorStr = priorSnaps.length
        ? priorSnaps[priorSnaps.length - 1].snapshotDate.toISOString().slice(0, 10)
        : null;
      const missing = lastPriorStr ? datesBetween(lastPriorStr, todayStr) : [];
      for (const dStr of missing) {
        if (dStr === todayStr) continue; // today is handled separately below
        const d = new Date(dStr + 'T00:00:00Z');
        const endOfD = new Date(d); endOfD.setUTCHours(23, 59, 59, 999);
        const pMatrix = computePipelineMatrix(allProjects, endOfD);
        await prisma.gridSnapshot.upsert({
          where:  { snapshotDate: d },
          create: { snapshotDate: d, label: null, t1Json: { rows: c4Rows, allMonths: c4Months }, t2Json: pMatrix, t3Json: globalTransmission },
          update: {                                t1Json: { rows: c4Rows, allMonths: c4Months }, t2Json: pMatrix, t3Json: globalTransmission },
        });
        if (!snapshotsList.some(s => s.snapshotDate.toISOString().slice(0, 10) === dStr)) {
          snapshotsList = [...snapshotsList, { id: `bf-${dStr}`, snapshotDate: d, label: null }];
        }
      }

      // Today's snapshot — always global, never the scoped view.
      await prisma.gridSnapshot.upsert({
        where:  { snapshotDate: today },
        create: { snapshotDate: today, label: null, t1Json: { rows: c4Rows, allMonths: c4Months }, t2Json: globalPipelineMatrix, t3Json: globalTransmission },
        update: {                                    t1Json: { rows: c4Rows, allMonths: c4Months }, t2Json: globalPipelineMatrix, t3Json: globalTransmission },
      });
      if (!snapshotsList.some(s => s.snapshotDate.toISOString().slice(0, 10) === todayStr)) {
        snapshotsList = [...snapshotsList, { id: 'today', snapshotDate: today, label: null }];
      }
    } catch (e) {
      console.error('[dashboard] auto-snapshot failed:', e?.message);
    }
  }

  // Serialise available snapshot dates for the "As on" picker + Last-changes
  // card. Refetch WITH content JSON so we can drop dates whose T1/T2/T3 are
  // identical to the previous date — i.e. days where nothing actually changed.
  // Without this, the LastChangesCard ends up comparing two identical days and
  // displays a noisy "No changes between X and Y" banner.
  //
  // IMPORTANT: today's snapshot is preserved even when its content matches the
  // previous change-point — LastChangesCard uses it as the "to" date for the
  // historical-vs-today comparison. If today gets deduped out, `to` falls back
  // to the previous change-point and the comparison loses its anchor.
  const snapshotsForDedupe = await prisma.gridSnapshot.findMany({
    select: { id: true, snapshotDate: true, label: true, t1Json: true, t2Json: true, t3Json: true },
    orderBy: { snapshotDate: 'asc' },
  });
  const todayStr = new Date().toISOString().slice(0, 10);
  const changePoints = [];
  let prevHash = null;
  for (const s of snapshotsForDedupe) {
    const h = JSON.stringify([s.t1Json, s.t2Json, s.t3Json]);
    const dateStr = s.snapshotDate.toISOString().slice(0, 10);
    if (h !== prevHash || dateStr === todayStr) {
      changePoints.push(s);
      prevHash = h;
    }
  }
  const availableSnapshots = changePoints.map(s => ({
    date:  s.snapshotDate.toISOString().slice(0, 10),
    label: s.label,
  }));

  return (
    <SummaryPageClient
      regionLabel={regionLabel}
      asOf={asOfStr}
      activityFrom={activityFromStr}
      activityTo={activityToStr}
      regions={allRegions.map(r => ({ code: r.code, name: r.name }))}
      selectedRegions={effectiveRegions}
      canFilterRegion={!isRegionLocked}
      sources={SOURCE_ORDER}
      selectedSources={selectedSources}
      hybridMode={hybridMode}
      excludeCommissioned={excludeCommissioned}
      hybridParts={availableHybridParts}
      selectedHybridParts={selectedHybridParts}
      stats={{ totalApplied, totalFtc, totalToc, totalCod, contd4Active, txPending }}
      table2Rows={JSON.parse(JSON.stringify(table2Rows))}
      table5Rows={JSON.parse(JSON.stringify(table5Rows))}
      contd4Study={JSON.parse(JSON.stringify(contd4Study))}
      transmissionRows={JSON.parse(JSON.stringify(transmissionRows))}
      hybridRows={JSON.parse(JSON.stringify(hybridRows))}
      hybridBreakup={JSON.parse(JSON.stringify(hybridBreakup))}
      bessProjects={JSON.parse(JSON.stringify(bessProjects))}
      activity={JSON.parse(JSON.stringify(activity))}
      projects={JSON.parse(JSON.stringify(viewProjects))}
      txElements={JSON.parse(JSON.stringify(txElements))}
      availableSnapshots={availableSnapshots}
    />
  );
}
