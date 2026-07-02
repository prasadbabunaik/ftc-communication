// Shared computation functions for Summary page and Excel export.
// All functions are pure — they take data arrays + optional filter params, return plain objects.

export const REGION_ORDER = ['NR', 'WR', 'SR', 'ER', 'NER'];
export const SOURCE_ORDER = ['WIND', 'SOLAR', 'BESS', 'HYBRID', 'COAL', 'HYDRO', 'PSP'];

// Display labels for CONTD-4 study table (UI only — used by SummaryPageClient
// to render friendly names for hybrid sub-type plant codes coming from PlantType.code).
export const CONTD4_SOURCE_LABEL = {
  WIND: 'Wind', SOLAR: 'Solar', BESS: 'BESS',
  HYBRID:     'Hybrid',
  HYBRID_WS:  'Hybrid (Wind+Solar)',
  HYBRID_SB:  'Hybrid (Solar+BESS)',
  HYBRID_WSB: 'Hybrid (Wind+Solar+BESS)',
  HYBRID_WB:  'Hybrid (Wind+BESS)',
  HYBRID_WP:  'Hybrid (Wind+PSP)',
  HYBRID_HP:  'Hybrid (Hydro+PSP)',
  HYBRID_SP:  'Hybrid (Solar+PSP)',
  COAL: 'Coal', HYDRO: 'Hydro', PSP: 'PSP',
};

// CONTD-4 status has exactly three values. Older PENDING/RECEIVED rows were
// merged into UNDER_PROCESS; keep them mapped so any stale string still renders.
export const CONTD4_STATUS_LABEL = {
  UNDER_PROCESS: 'Under Process',
  CLEARED:       'Cleared',
  REJECTED:      'Rejected',
  PENDING:       'Under Process',
  RECEIVED:      'Under Process',
};
export const CONTD4_STATUS_BADGE = {
  UNDER_PROCESS: 'bg-amber-50 text-amber-700 border-amber-200',
  CLEARED:       'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED:      'bg-red-50 text-red-700 border-red-200',
  PENDING:       'bg-amber-50 text-amber-700 border-amber-200',
  RECEIVED:      'bg-amber-50 text-amber-700 border-amber-200',
};

export function n(v) { return v != null ? Number(v) : 0; }

// Returns the milestone capacity (FTC / TOC / COD) for a phase as-of a given
// date, using ONE consistent rule for every date — including "now".
//
// A milestone counts only once its date has arrived: we sum the per-event
// rows whose `eventDate ≤ cutoff`. The cutoff is the requested `asOf`, or
// today's end-of-day when `asOf` is null ("as of now"). A future-dated FTC
// (e.g. Tehri's FTC date 03-Jun-2026) therefore does NOT count toward the
// live total until that date arrives — and, crucially, the live view and the
// historical view are now computed identically, so diffing consecutive
// snapshots no longer produces phantom day-over-day changes.
//
// Fallback when a phase has no per-event rows: gate the single cached
// completion date the same way (count the cached MW only if that date ≤
// cutoff). A phase with cached MW but no temporal info at all (no events,
// no date) is treated as "completed without recorded timing" and contributes
// its full cached MW — returning 0 there would silently hide capacity the
// operations team reported via the aggregate cell.
export function milestoneAsOf(events, asOf, fallbackDate, fallbackMw) {
  let cutoff = asOf;
  if (!cutoff) { cutoff = new Date(); cutoff.setUTCHours(23, 59, 59, 999); }
  if (events && events.length > 0) {
    let sum = 0;
    for (const e of events) {
      if (new Date(e.eventDate) <= cutoff) sum += n(e.capacityMw);
    }
    return sum;
  }
  if (fallbackDate) {
    return new Date(fallbackDate) <= cutoff ? n(fallbackMw) : 0;
  }
  return n(fallbackMw);
}

// A project belongs to the FTC pipeline when it has been entered into FTC
// directly (inFtcPipeline flag) OR its CONTD-4 was cleared (the legacy
// bridge). The two pages are independent — a project may be in FTC while its
// CONTD-4 is still pending or never issued.
export function isInFtcPipeline(project) {
  return project.inFtcPipeline === true || project.contd4?.status === 'CLEARED';
}

export function getProjectSource(project) {
  if (project.plantType.isHybrid) return 'HYBRID';
  if (project.phases.length > 0) return project.phases[0].sourceType;
  const label = project.plantType.label.toUpperCase();
  if (label.includes('WIND'))                              return 'WIND';
  if (label.includes('SOLAR'))                             return 'SOLAR';
  if (label.includes('BESS') || label.includes('BATTERY')) return 'BESS';
  if (label.includes('COAL') || label.includes('THERMAL')) return 'COAL';
  if (label.includes('HYDRO'))                             return 'HYDRO';
  if (label.includes('PSP')  || label.includes('PUMP'))   return 'PSP';
  return 'OTHER';
}

function emptyPipelineRow(region, source) {
  return {
    region, source,
    totalCapacityMw: 0, contd4CapacityMw: 0,
    appliedMw: 0, ftcApprovedMw: 0, ftcPendingMw: 0,
    tocIssuedMw: 0, tocPendingMw: 0,
    codCompletedMw: 0, codPendingMw: 0, expectedMw: 0,
  };
}

// ── Table 2 & 5 — FTC Pipeline (region × source) ─────────────────────────────

// options.foldHybridComponents — when true, hybrid projects are NOT bucketed
//   under a single 'HYBRID' source. Instead each hybrid's per-component figures
//   (from hybridComponentsJson) are distributed into their constituent source
//   buckets (WIND / SOLAR / BESS / PSP …). This is the FTC Pipeline tab's
//   "Including Hybrid" view: e.g. the WIND row then carries pure-wind projects
//   PLUS the wind component of every hybrid. The default (false) keeps the
//   legacy "Excluding Hybrid" view where hybrids sit in their own HYBRID row.
//   Note: component figures come from the segregation sheet and need not sum to
//   the hybrid's aggregate phase totals (the two are tracked at different
//   granularities) — see computeHybridBreakdown.
export function computePipelineMatrix(projects, asOf = null, options = {}) {
  const foldHybrid = options.foldHybridComponents === true;
  const matrix = {};
  const inPipeline = projects.filter(isInFtcPipeline);

  // Hybrid seed inserts duplicate shadow rows for some projects (same
  // hybridComponentsJson); count each hybrid once when folding.
  const seenHybridName = new Set();

  // One phase's funnel figures — the atom both figuresOf() (project totals)
  // and the phase-level hybrid fold are built from, so a hybrid split by its
  // phases sums back to EXACTLY the project figure (reconciliation invariant).
  const phaseFiguresOf = (ph) => ({
    appliedMw:      n(ph.capacityAppliedMw),
    // Date-gated milestone totals — per-event sums when `asOf` is set, else the
    // cached totals (see milestoneAsOf).
    ftcApprovedMw:  milestoneAsOf(ph.ftcEvents, asOf, ph.ftcCompletedDate, ph.ftcCompletedMw),
    tocIssuedMw:    milestoneAsOf(ph.tocEvents, asOf, ph.tocIssuedDate,    ph.tocIssuedMw),
    codCompletedMw: milestoneAsOf(ph.codEvents, asOf, ph.codDeclaredDate,  ph.codDeclaredMw),
    expectedMw:     n(ph.expectedApr26Mw),
  });
  const FUNNEL_FIELDS = ['appliedMw', 'ftcApprovedMw', 'tocIssuedMw', 'codCompletedMw', 'expectedMw'];

  // A project's pipeline figures from its phase-based commissioning data — the
  // SAME source that drives the headline KPIs. Computed once here and used by
  // BOTH the default bucket and the hybrid fold, so the Excl and Incl views can
  // never disagree on the underlying magnitudes.
  const figuresOf = (proj) => {
    const f = {
      totalCapacityMw:  n(proj.totalCapacityMw),
      // CONTD-4 issued capacity defaults to the plant's total when not explicitly
      // recorded — matches the FTC tracker's CONTD-4 (MW) column so they reconcile.
      contd4CapacityMw: proj.contd4?.capacityApr26Mw != null ? n(proj.contd4.capacityApr26Mw) : n(proj.totalCapacityMw),
      appliedMw: 0, ftcApprovedMw: 0, tocIssuedMw: 0, codCompletedMw: 0, expectedMw: 0,
    };
    for (const ph of proj.phases) {
      const pf = phaseFiguresOf(ph);
      for (const k of FUNNEL_FIELDS) f[k] += pf[k];
    }
    return f;
  };
  const addFigures = (row, f, share = 1) => {
    row.totalCapacityMw  += f.totalCapacityMw  * share;
    row.contd4CapacityMw += f.contd4CapacityMw * share;
    row.appliedMw        += f.appliedMw        * share;
    row.ftcApprovedMw    += f.ftcApprovedMw    * share;
    row.tocIssuedMw      += f.tocIssuedMw      * share;
    row.codCompletedMw   += f.codCompletedMw   * share;
    row.expectedMw       += f.expectedMw       * share;
  };

  for (const proj of inPipeline) {
    const region = proj.region.code;
    const comps  = proj.hybridComponentsJson?.components ?? [];

    // ── Including-Hybrid: split each hybrid into its component sources.
    //    Attribution ladder (first available wins):
    //      1. Segregation JSON — split the project's phase-based figures by
    //         each component's capacity share (seeded hybrids).
    //      2. Commissioning phases — each phase already carries a concrete
    //         SourceType, so its own funnel figures go straight to that source
    //         (exact, no proration); the project-level Total/CONTD-4 capacity
    //         is prorated by per-source applied share (falling back to the
    //         wind/solar/bess capacity columns, then an equal split).
    //      3. Per-source capacity columns — phaseless hybrids (e.g. CONTD-4
    //         cleared before any commissioning data): split Total/CONTD-4 by
    //         the windCapacityMw/solarCapacityMw/bessCapacityMw columns.
    //    Every rung sums back to exactly the Excl-view figures, so the two
    //    views always reconcile. Only a hybrid with NONE of the three falls
    //    through to the residual HYBRID bucket — and the server actions now
    //    block such hybrids from entering the pipeline in the first place.
    if (foldHybrid && proj.plantType.isHybrid) {
      // 1. Segregation JSON (seed inserts duplicate shadow rows — count once).
      if (comps.length) {
        if (seenHybridName.has(proj.name)) continue;
        seenHybridName.add(proj.name);
        const f = figuresOf(proj);
        const shareBase = comps.reduce((s, c) => s + n(c.totalMw), 0);
        comps.forEach((c) => {
          const share = shareBase > 0 ? n(c.totalMw) / shareBase : 1 / comps.length;
          const key = `${region}|${c.sourceType}`;
          if (!matrix[key]) matrix[key] = emptyPipelineRow(region, c.sourceType);
          addFigures(matrix[key], f, share);
        });
        continue;
      }

      // 2. Phase-level split.
      const phases = proj.phases ?? [];
      if (phases.length) {
        const bySource = {};
        for (const ph of phases) {
          const acc = (bySource[ph.sourceType] ??= { appliedMw: 0, ftcApprovedMw: 0, tocIssuedMw: 0, codCompletedMw: 0, expectedMw: 0 });
          const pf = phaseFiguresOf(ph);
          for (const k of FUNNEL_FIELDS) acc[k] += pf[k];
        }
        // Weight for prorating the project-level Total/CONTD-4 capacity:
        // applied share → capacity columns → equal split.
        const sources = Object.keys(bySource);
        const CAP_COL = { WIND: 'windCapacityMw', SOLAR: 'solarCapacityMw', BESS: 'bessCapacityMw' };
        let weights = sources.map((s) => bySource[s].appliedMw);
        if (!weights.some((w) => w > 0)) weights = sources.map((s) => n(proj[CAP_COL[s]]));
        if (!weights.some((w) => w > 0)) weights = sources.map(() => 1);
        const wBase = weights.reduce((a, b) => a + b, 0);
        const totalCap  = n(proj.totalCapacityMw);
        const contd4Cap = proj.contd4?.capacityApr26Mw != null ? n(proj.contd4.capacityApr26Mw) : totalCap;
        sources.forEach((s, i) => {
          const key = `${region}|${s}`;
          if (!matrix[key]) matrix[key] = emptyPipelineRow(region, s);
          const row = matrix[key];
          for (const k of FUNNEL_FIELDS) row[k] += bySource[s][k];
          row.totalCapacityMw  += totalCap  * (weights[i] / wBase);
          row.contd4CapacityMw += contd4Cap * (weights[i] / wBase);
        });
        continue;
      }

      // 3. Capacity-column split (no phases → funnel figures are all zero).
      const capSplit = [
        ['WIND', n(proj.windCapacityMw)], ['SOLAR', n(proj.solarCapacityMw)], ['BESS', n(proj.bessCapacityMw)],
      ].filter(([, v]) => v > 0);
      if (capSplit.length) {
        const f = figuresOf(proj);
        const base = capSplit.reduce((s, [, v]) => s + v, 0);
        for (const [s, v] of capSplit) {
          const key = `${region}|${s}`;
          if (!matrix[key]) matrix[key] = emptyPipelineRow(region, s);
          addFigures(matrix[key], f, v / base);
        }
        continue;
      }
      // 4. Nothing to split by → falls through to the residual HYBRID bucket.
    }

    // ── Default path: bucket the whole project by its source. In fold mode a
    //    hybrid with no source data lands here as HYBRID (residual);
    //    buildPipelineRows keeps that row so Incl still reconciles with Excl. ──
    const source = getProjectSource(proj);
    const key    = `${region}|${source}`;
    if (!matrix[key]) matrix[key] = emptyPipelineRow(region, source);
    addFigures(matrix[key], figuresOf(proj));
  }
  // Pending columns are the funnel GAPS (clamped ≥ 0), so each pair reconciles:
  //   FTC Approved + FTC Pending = Applied,  TOC + TOC Pending = FTC Approved,
  //   COD Done + COD Pending = TOC Issued.
  // Deriving them from the live totals (not the cached under-/pending fields)
  // avoids stale negatives — e.g. COD Pending < 0 when the cached field drifts.
  const r3 = (x) => Math.round(x * 1000) / 1000;
  for (const row of Object.values(matrix)) {
    row.ftcPendingMw = Math.max(0, r3(row.appliedMw - row.ftcApprovedMw));
    row.tocPendingMw = Math.max(0, r3(row.ftcApprovedMw - row.tocIssuedMw));
    row.codPendingMw = Math.max(0, r3(row.tocIssuedMw - row.codCompletedMw));
  }
  return matrix;
}

const PIPELINE_NUMERIC_FIELDS = [
  'totalCapacityMw', 'contd4CapacityMw', 'appliedMw',
  'ftcApprovedMw', 'ftcPendingMw',
  'tocIssuedMw', 'tocPendingMw',
  'codCompletedMw', 'codPendingMw', 'expectedMw',
];

export function buildPipelineRows(matrix, primaryKey, secondaryKey, filters = {}) {
  const rows = [];
  const allIndia = emptyPipelineRow('All India', 'Total');

  // When a region/source filter is active, scaffold only the matching axis so
  // the table actually narrows (not just zeroes the unselected rows). Filters
  // are arrays (multi-select); empty/absent means "all". Canonical order kept.
  const regionValues = filters.regions?.length ? REGION_ORDER.filter((r) => filters.regions.includes(r)) : REGION_ORDER;
  let   sourceValues = filters.sources?.length ? SOURCE_ORDER.filter((s) => filters.sources.includes(s)) : SOURCE_ORDER;
  // Including-Hybrid view folds hybrids into their source rows. Hybrids WITH a
  // component segregation split cleanly; hybrids WITHOUT one can't be split, so
  // they remain in a residual HYBRID bucket. Keep the HYBRID axis value so that
  // residual still shows and — crucially — still counts in the subtotals, so
  // the Incl-Hybrid total reconciles with Excl-Hybrid. Empty HYBRID rows are
  // skipped per-region below, so fully-folded regions stay clean.
  const foldMode = !!filters.excludeHybrid;
  const primaryValues   = primaryKey   === 'region' ? regionValues : sourceValues;
  const secondaryValues = secondaryKey === 'source' ? sourceValues : regionValues;

  // Single-region scope (e.g. an RLDC):
  //  • Region-wise: the per-region group equals the consolidated "All India"
  //    breakdown, so omit the group and show only the consolidated one.
  //  • Source-wise: each source's sole region sub-row equals its subtotal, so
  //    omit the redundant per-source subtotal.
  const singleRegionRegionWise = primaryKey === 'region' && primaryValues.length === 1;
  const singleRegionSourceWise = primaryKey === 'source' && secondaryValues.length === 1;

  // Per-secondary aggregates across all primaries — used to build the
  // All India source breakdown (or, in source-wise view, the Total-region
  // per-region breakdown) before the grand total.
  const aggBySecondary = {};
  for (const sv of secondaryValues) {
    const baseRegion = primaryKey === 'region' ? 'All India' : sv;
    const baseSource = secondaryKey === 'source' ? sv : 'Total';
    const r = emptyPipelineRow(baseRegion, baseSource);
    r.isAllIndiaBreakdown = true;
    aggBySecondary[sv] = r;
  }

  for (const pv of primaryValues) {
    const group = [];
    let hasAnyData = false;

    for (const sv of secondaryValues) {
      const key = primaryKey === 'region' ? `${pv}|${sv}` : `${sv}|${pv}`;
      const row = matrix[key];
      const hasData = !!(row && (row.appliedMw + row.totalCapacityMw > 0));
      // Incl-Hybrid: only surface a residual HYBRID row where un-decomposable
      // hybrids left capacity behind; skip empty ones so folded regions stay clean.
      if (foldMode && sv === 'HYBRID' && !hasData) continue;
      if (hasData) hasAnyData = true;
      const baseRegion = primaryKey === 'region' ? pv : sv;
      const baseSource = secondaryKey === 'source' ? sv : pv;
      group.push({ ...(row ?? emptyPipelineRow(baseRegion, baseSource)), [primaryKey]: pv, [secondaryKey]: sv });
    }
    if (!hasAnyData) continue; // skip regions/sources that have absolutely no data
    if (!singleRegionRegionWise) rows.push(...group);

    // Store pv in the primary key's field so label reads correctly in both pipelines.
    const subtotal = primaryKey === 'region'
      ? emptyPipelineRow(pv, 'Total')   // region=pv, source='Total'
      : emptyPipelineRow('Total', pv);  // region='Total', source=pv
    for (const r of group) {
      for (const f of PIPELINE_NUMERIC_FIELDS) subtotal[f] += r[f];

      // Accumulate per-secondary totals for the All India breakdown.
      const sv = r[secondaryKey];
      const agg = aggBySecondary[sv];
      if (agg) for (const f of PIPELINE_NUMERIC_FIELDS) agg[f] += r[f];
    }
    subtotal.isSubtotal = true;
    if (!singleRegionRegionWise && !singleRegionSourceWise) rows.push(subtotal);

    for (const f of PIPELINE_NUMERIC_FIELDS) allIndia[f] += subtotal[f];
  }

  // All India per-source breakdown rows (region-wise view only — mirrors how
  // each region shows its own source breakdown above).
  if (primaryKey === 'region') {
    for (const sv of secondaryValues) {
      const r = aggBySecondary[sv];
      if (r.totalCapacityMw > 0 || r.appliedMw > 0) rows.push(r);
    }
  }

  allIndia.isTotal = true;
  rows.push(allIndia);
  return rows;
}

// Per-region (and All-India) split of the HYBRID bucket into its component
// sources — the same figures the "Split by Source" fold produces, but computed
// over hybrids ONLY. Powers the expandable hybrid breakup under each HYBRID row
// in the FTC-pipeline table (so a HYBRID row of 1,434 MW can reveal Wind / Solar
// / BESS parts that sum back to it). Returns { [region]: [{ source, …funnel }] }
// with an added 'All India' key.
export function computeHybridComponentBreakup(projects, asOf = null) {
  const hybridOnly = (projects ?? []).filter((p) => p.plantType?.isHybrid);
  const m = computePipelineMatrix(hybridOnly, asOf, { foldHybridComponents: true });
  const byRegion = {};
  const allIndia = {};
  for (const [key, r] of Object.entries(m)) {
    const [region, source] = key.split('|');
    (byRegion[region] ??= []).push({ source, ...r });
    if (!allIndia[source]) allIndia[source] = { source, ...emptyPipelineRow('All India', source) };
    for (const f of PIPELINE_NUMERIC_FIELDS) allIndia[source][f] += r[f];
  }
  const bySourceOrder = (a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source);
  for (const region of Object.keys(byRegion)) byRegion[region].sort(bySourceOrder);
  byRegion['All India'] = Object.values(allIndia).sort(bySourceOrder);
  return byRegion;
}

// ── Table 1 — CONTD-4 Study ───────────────────────────────────────────────────

// CONTD-4 study uses fixed source rows matching the Excel layout —
// Wind, Solar, BESS, then hybrid sub-types. Zero rows are emitted so the
// table always shows the full grid per region.
export const CONTD4_STUDY_SOURCES = [
  'WIND', 'SOLAR', 'BESS',
  'HYBRID_WS', 'HYBRID_SB', 'HYBRID_WSB',
  'HYBRID_WB', 'HYBRID_WP', 'HYBRID_HP', 'HYBRID_SP',
  'COAL', 'HYDRO', 'PSP',
];

// For CONTD-4 study, hybrids are kept as their sub-type code rather than collapsed to 'HYBRID'.
function getContd4StudySource(project) {
  if (project.plantType.isHybrid) return project.plantType.code;
  return getProjectSource(project);
}

// "YYYY-MM" string for the current month (UTC-safe).
function currentYearMonth(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * computeContd4Study(projects, options)
 *
 * options.referenceMonth — "YYYY-MM" that acts as the carry-forward cutoff.
 *   Any phase whose target month is BEFORE this value gets attributed to the
 *   reference month instead of its original target. The intuition: if April
 *   passed and the project is still active (not CLEARED), the April capacity
 *   is now expected in / from the current month onward. Defaults to the
 *   real-world current month.
 *
 * options.carryForward — set to `false` to disable rollover (debug / Excel
 *   parity testing). Defaults to true.
 */
export function computeContd4Study(projects, options = {}) {
  const referenceMonth = options.referenceMonth || currentYearMonth();
  const carryForward   = options.carryForward !== false;

  // Optional region/source filters (dashboard tab filters). Arrays (multi-
  // select); empty/absent means "all". Region narrows the scaffold; source
  // narrows the shown source rows — the HYBRID bucket expands to every hybrid
  // sub-type code.
  const regionOrder  = options.regions?.length ? REGION_ORDER.filter((r) => options.regions.includes(r)) : REGION_ORDER;
  const sourceFilter = options.sources?.length
    ? new Set(options.sources.flatMap((b) => b === 'HYBRID'
        ? CONTD4_STUDY_SOURCES.filter((s) => s.startsWith('HYBRID'))
        : [b]))
    : null;

  const active = projects.filter(p =>
    p.contd4 && p.contd4.status !== 'CLEARED' && p.contd4.status !== 'REJECTED'
  );

  const matrix = {};
  const allMonthsSet = new Set();
  const sourcesUsed  = new Set();
  let   carriedTotal = 0;  // sanity stat — total MW shifted due to rollover

  // Always surface the reference month column so the carry-forward target is
  // visible even when nothing originally targeted it.
  if (carryForward) allMonthsSet.add(referenceMonth);

  for (const proj of active) {
    const region = proj.region.code;
    const source = getContd4StudySource(proj);
    sourcesUsed.add(source);
    const key    = `${region}|${source}`;
    if (!matrix[key]) matrix[key] = { region, source, totalMw: 0, months: {} };

    matrix[key].totalMw += n(proj.totalCapacityMw);

    // Capacity is tracked per-phase (Contd4Phase). Sum each phase into its
    // target month so a single project can contribute to multiple months.
    // If carryForward is enabled, phases whose target month is in the past
    // (relative to referenceMonth) attribute to referenceMonth instead.
    const phaseList = proj.contd4.phases ?? [];
    if (phaseList.length > 0) {
      for (const ph of phaseList) {
        let month = ph.capacityMonth;
        const mw  = n(ph.capacityMw);
        if (month && carryForward && month < referenceMonth) {
          carriedTotal += mw;
          month = referenceMonth;
        }
        if (month) {
          allMonthsSet.add(month);
          if (mw) matrix[key].months[month] = (matrix[key].months[month] ?? 0) + mw;
        }
      }
    } else {
      // Legacy fallback path — used only when queries don't include the
      // phases relation. Applies the same carry-forward rule.
      let month = proj.contd4.capacityMonth;
      const mw  = n(proj.contd4.capacityApr26Mw);
      if (month && carryForward && month < referenceMonth) {
        carriedTotal += mw;
        month = referenceMonth;
      }
      if (month) {
        allMonthsSet.add(month);
        if (mw) matrix[key].months[month] = (matrix[key].months[month] ?? 0) + mw;
      }
    }
  }

  // Show the 6 Excel-standard rows plus any other source that has actual data.
  const baseSources = ['WIND', 'SOLAR', 'BESS', 'HYBRID_WS', 'HYBRID_SB', 'HYBRID_WSB'];
  const extraSources = CONTD4_STUDY_SOURCES.filter(
    (s) => !baseSources.includes(s) && sourcesUsed.has(s),
  );
  const sourcesToShowAll = [...baseSources, ...extraSources];
  const sourcesToShow = sourceFilter
    ? sourcesToShowAll.filter((s) => sourceFilter.has(s))
    : sourcesToShowAll;

  const allMonths = [...allMonthsSet].sort();
  const rows = [];

  // Single-region scope (e.g. an RLDC): the per-region breakdown duplicates the
  // consolidated "All India" breakdown below, so omit it and show only the
  // consolidated view (no redundant repeat).
  const singleRegion = regionOrder.length === 1;

  if (!singleRegion) {
    for (const region of regionOrder) {
      const regionRows = sourcesToShow.map((source) => {
        const row = matrix[`${region}|${source}`];
        return row ?? { region, source, totalMw: 0, months: {} };
      });
      rows.push(...regionRows);

      const subtotal = { region, source: 'Total', totalMw: 0, months: {}, isSubtotal: true };
      for (const r of regionRows) {
        subtotal.totalMw += r.totalMw;
        for (const m of allMonths) {
          subtotal.months[m] = (subtotal.months[m] ?? 0) + (r.months[m] ?? 0);
        }
      }
      rows.push(subtotal);
    }
  }

  // All India breakdown: one row per source aggregating across all regions,
  // followed by a grand-total row (matches Excel R27-R33 layout). For a single
  // region this IS the only breakdown shown.
  for (const source of sourcesToShow) {
    const aggRow = { region: 'All India', source, totalMw: 0, months: {}, isAllIndiaBreakdown: true };
    for (const region of regionOrder) {
      const r = matrix[`${region}|${source}`];
      if (!r) continue;
      aggRow.totalMw += r.totalMw;
      for (const m of allMonths) {
        aggRow.months[m] = (aggRow.months[m] ?? 0) + (r.months[m] ?? 0);
      }
    }
    rows.push(aggRow);
  }

  const allIndia = { region: 'All India', source: 'Total', totalMw: 0, months: {}, isTotal: true };
  // Sum the per-region subtotals normally; for a single region there are none,
  // so sum the consolidated breakdown rows instead.
  const totalSourceRows = singleRegion
    ? rows.filter((r) => r.isAllIndiaBreakdown)
    : rows.filter((r) => r.isSubtotal);
  for (const r of totalSourceRows) {
    allIndia.totalMw += r.totalMw;
    for (const m of allMonths) {
      allIndia.months[m] = (allIndia.months[m] ?? 0) + (r.months[m] ?? 0);
    }
  }
  rows.push(allIndia);

  return { rows, allMonths, referenceMonth, carriedTotal };
}

// ── Table 3 — Transmission ────────────────────────────────────────────────────

export function computeTransmission(txElements) {
  function getCategory(el) {
    const type = el.elementType;
    const re   = el.isRe;
    if (type === 'LINE') return re ? 'LINE_RE' : 'LINE_NONRE';
    if (type === 'ICT')  return re ? 'ICT_RE'  : 'ICT_NONRE';
    return type;
  }

  const matrix = {};
  for (const el of txElements) {
    const region   = el.region.code;
    const category = getCategory(el);
    const key = `${region}|${category}`;
    if (!matrix[key]) matrix[key] = {
      region, category,
      completedCount: 0, completedMva: 0, completedKm: 0,
      pendingCount: 0,   pendingMva: 0,   pendingKm: 0,
    };
    const row = matrix[key];
    if (!el.pendingFtc) {
      row.completedCount++;
      row.completedMva += n(el.capacityMva);
      row.completedKm  += n(el.lineLengthKm);
    } else {
      row.pendingCount++;
      row.pendingMva += n(el.capacityApr26Mva);
      row.pendingKm  += n(el.lineLengthApr26Km);
    }
  }

  const CAT_ORDER = ['LINE_RE', 'LINE_NONRE', 'ICT_RE', 'ICT_NONRE', 'GT', 'ST'];
  const rows = [];
  for (const region of REGION_ORDER) {
    for (const cat of CAT_ORDER) {
      const row = matrix[`${region}|${cat}`];
      if (row) rows.push(row);
    }
  }
  return rows;
}

// ── Table 4 — Hybrid Breakdown ────────────────────────────────────────────────

// Compute the per-component Hybrid Breakdown. Data source = the Excel's
// "Source wise Segregation of hybrid Generation Capacity" sheet, captured
// into GenerationProject.hybridComponentsJson by the seed/backfill scripts.
//
// Why a separate source from the FTC Pipeline phases? The aggregate row
// (used by FTC Pipeline) reports the project's combined milestone totals,
// while the segregation rows report a per-source split (Solar / Wind /
// BESS / PSP). The two don't always match — e.g. Juniper Green Stellar
// has 365 MW applied at the aggregate but 285 + 0 + 180 = 465 MW summed
// across components, because the workbook tracks them in different
// granularities. Hybrid Breakdown must use the per-component data to
// match the Google Sheet's hybrid summary cell-for-cell.
//
// `asOf` honours the same convention as milestoneAsOf() — a component's
// milestone MW counts only once its date has arrived (date ≤ cutoff), where
// the cutoff is `asOf` or today's end-of-day when null. A component with MW
// but no date is treated as completed-without-timing and always counts.
// componentSources (optional): restrict each hybrid to the listed component
// source types (Solar+Hybrid → only Solar rows). Empty = all components.
export function computeHybridBreakdown(projects, asOf = null, componentSources = []) {
  const cleared = projects.filter(p => isInFtcPipeline(p) && p.hybridComponentsJson);
  const matrix  = {};

  let cutoff = asOf;
  if (!cutoff) { cutoff = new Date(); cutoff.setUTCHours(23, 59, 59, 999); }
  const gate = (mw, date) => {
    if (!date) return n(mw);
    return new Date(date) <= cutoff ? n(mw) : 0;
  };

  // Dedup helper — the seed inserts both an aggregate row and a per-
  // component shadow row for some hybrid projects (e.g. AGE26BL Khavda
  // PSS10 has 2 DB rows). They share the same hybridComponentsJson via
  // the backfill, so we count each project only once.
  const seenName = new Set();

  for (const proj of cleared) {
    if (seenName.has(proj.name)) continue;
    seenName.add(proj.name);

    const region     = proj.region.code;
    const data       = proj.hybridComponentsJson;
    const hybridType = data?.hybridType || proj.plantType.label;
    const components = data?.components || [];

    for (const c of components) {
      if (componentSources.length && !componentSources.includes(c.sourceType)) continue;
      const key = `${region}|${hybridType}|${c.sourceType}`;
      if (!matrix[key]) {
        matrix[key] = {
          region, hybridType, sourceType: c.sourceType,
          totalMw: 0, contd4Mw: 0, appliedMw: 0,
          ftcMw: 0, tocMw: 0, codMw: 0, expectedMw: 0,
        };
      }
      const row = matrix[key];
      row.totalMw    += n(c.totalMw);
      row.contd4Mw   += n(c.contd4Mw);
      row.appliedMw  += n(c.appliedMw);
      row.ftcMw      += gate(c.ftcMw, c.ftcDate);
      row.tocMw      += gate(c.tocMw, c.tocDate);
      row.codMw      += gate(c.codMw, c.codDate);
      row.expectedMw += n(c.expectedMw);
    }
  }

  return Object.values(matrix).sort((a, b) => {
    const ri = REGION_ORDER.indexOf(a.region) - REGION_ORDER.indexOf(b.region);
    if (ri !== 0) return ri;
    const hi = (a.hybridType || '').localeCompare(b.hybridType || '');
    if (hi !== 0) return hi;
    return SOURCE_ORDER.indexOf(a.sourceType) - SOURCE_ORDER.indexOf(b.sourceType);
  });
}

// ── Monthly COD month range helper ────────────────────────────────────────────

export function buildCodMonths(fromMonth = null, toMonth = null) {
  if (fromMonth && toMonth) {
    const months = [];
    let [y, m] = fromMonth.split('-').map(Number);
    const [ty, tm] = toMonth.split('-').map(Number);
    while (y < ty || (y === ty && m <= tm)) {
      months.push(`${y}-${String(m).padStart(2, '0')}`);
      if (++m > 12) { m = 1; y++; }
    }
    return months;
  }
  // Default: last 3 months + next 1
  const now = new Date();
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i - 3, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}

// ── Milestone Activity in a date range ───────────────────────────────────────
// "How much FTC / TOC / COD happened between two dates" — sums the per-event
// MW whose eventDate falls within [from, to] (inclusive), grouped by
// Region × Source. This is the milestone-date quantity view (Q1 from the
// day-wise-changes design): a milestone counts toward the window its date
// lands in, not when it was entered.
//
// from / to are Date objects (or null for an open bound). Pass `to` as the
// end-of-day for inclusive upper bounds.
// componentSources (optional): when set, hybrid projects contribute only the
// phases whose sourceType is in the list — so "Solar + Hybrid" shows just the
// solar slice of each hybrid. Empty = every component (the default).
//
// options.foldHybridComponents — Including-Hybrid view: a hybrid's phases are
//   bucketed under their own component source (Wind/Solar/BESS…) instead of a
//   single HYBRID row (and no per-component cell split is produced — the data
//   simply joins the normal source rows). Default false = Excluding-Hybrid.
// options.sources — restrict counting to these FINAL bucket sources (applied
//   after folding) so the totals/cards honour the source filter. Empty = all.
export function computeMilestoneActivity(projects, from = null, to = null, componentSources = [], options = {}) {
  const fold        = options.foldHybridComponents === true;
  const sourceAllow = options.sources?.length ? new Set(options.sources) : null;
  const inRange = (d) => {
    if (!d) return false;
    const t = new Date(d).getTime();
    if (from && t < from.getTime()) return false;
    if (to   && t > to.getTime())   return false;
    return true;
  };
  const matrix = {};
  const totals = { ftc: 0, toc: 0, cod: 0, ftcCount: 0, tocCount: 0, codCount: 0 };

  for (const proj of projects.filter(isInFtcPipeline)) {
    const region   = proj.region.code;
    const isHybrid = getProjectSource(proj) === 'HYBRID';
    const foldThis = fold && isHybrid;

    for (const ph of (proj.phases ?? [])) {
      const comp = ph.sourceType;
      // Restrict hybrids to the selected component sources (if any).
      if (isHybrid && componentSources.length && !componentSources.includes(comp)) continue;

      // Bucket source: when folding a hybrid, use the phase's own component
      // source; otherwise the project's bucket (HYBRID for hybrids).
      const source = foldThis ? comp : (isHybrid ? 'HYBRID' : getProjectSource(proj));
      if (sourceAllow && !sourceAllow.has(source)) continue;

      const key = `${region}|${source}`;
      if (!matrix[key]) matrix[key] = {
        region, source, ftc: 0, toc: 0, cod: 0, ftcCount: 0, tocCount: 0, codCount: 0,
        // Non-folded hybrid rows split each milestone by component source so
        // the pivot cell can read "180 – BESS / 211.4 – Solar …". Folded rows
        // join the normal source rows and need no split.
        components: (isHybrid && !foldThis) ? { ftc: {}, toc: {}, cod: {} } : null,
      };
      const row = matrix[key];
      const addComp = (bucket, c, mw) => { if (row.components) row.components[bucket][c] = (row.components[bucket][c] ?? 0) + mw; };
      for (const e of (ph.ftcEvents ?? [])) if (inRange(e.eventDate)) { const mw = n(e.capacityMw); row.ftc += mw; row.ftcCount++; totals.ftc += mw; totals.ftcCount++; addComp('ftc', comp, mw); }
      for (const e of (ph.tocEvents ?? [])) if (inRange(e.eventDate)) { const mw = n(e.capacityMw); row.toc += mw; row.tocCount++; totals.toc += mw; totals.tocCount++; addComp('toc', comp, mw); }
      for (const e of (ph.codEvents ?? [])) if (inRange(e.eventDate)) { const mw = n(e.capacityMw); row.cod += mw; row.codCount++; totals.cod += mw; totals.codCount++; addComp('cod', comp, mw); }
    }
  }
  return { matrix, totals };
}

// ── Table 6 — Monthly COD ─────────────────────────────────────────────────────

export function computeMonthlyCod(projects, fromMonth = null, toMonth = null) {
  const months  = buildCodMonths(fromMonth, toMonth);
  const cleared = projects.filter(isInFtcPipeline);
  const matrix  = {};

  for (const proj of cleared) {
    const region = proj.region.code;
    for (const ph of proj.phases) {
      if (!ph.codDeclaredDate || !ph.codDeclaredMw) continue;
      const source = proj.plantType.isHybrid ? 'HYBRID' : ph.sourceType;
      const d      = new Date(ph.codDeclaredDate);
      const month  = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!months.includes(month)) continue;
      if (!matrix[source]) matrix[source] = {};
      if (!matrix[source][region]) matrix[source][region] = {};
      matrix[source][region][month] = (matrix[source][region][month] ?? 0) + n(ph.codDeclaredMw);
    }
  }

  const rows = [];
  for (const source of SOURCE_ORDER) {
    if (!matrix[source]) continue;
    const byRegion = {};
    for (const region of REGION_ORDER) {
      byRegion[region] = {};
      for (const month of months) {
        byRegion[region][month] = matrix[source]?.[region]?.[month] ?? 0;
      }
    }
    rows.push({ source, byRegion });
  }

  const totalByRegion = {};
  for (const region of REGION_ORDER) {
    totalByRegion[region] = {};
    for (const month of months) {
      totalByRegion[region][month] = rows.reduce((s, r) => s + (r.byRegion[region]?.[month] ?? 0), 0);
    }
  }
  rows.push({ source: 'Total', byRegion: totalByRegion, isTotal: true });

  return { rows, months };
}

// ── Per-project aggregation (for detail sheets) ───────────────────────────────

export function aggregateProjectForExport(proj, asOf = null) {
  let applied = 0, ftcApproved = 0, tocIssued = 0, codDeclared = 0, expected = 0;

  // Same cutoff convention as milestoneAsOf: a milestone counts only once its
  // date has arrived. This export path has cached phase fields but not the
  // per-event rows, so it gates the cached MW by its single completion date
  // (a milestone with no recorded date counts as completed-without-timing).
  let cutoff = asOf;
  if (!cutoff) { cutoff = new Date(); cutoff.setUTCHours(23, 59, 59, 999); }
  const done = (date) => !date || new Date(date) <= cutoff;

  for (const ph of proj.phases) {
    applied += n(ph.capacityAppliedMw);

    ftcApproved += done(ph.ftcCompletedDate) ? n(ph.ftcCompletedMw) : 0;
    tocIssued   += done(ph.tocIssuedDate)    ? n(ph.tocIssuedMw)    : 0;
    codDeclared += done(ph.codDeclaredDate)  ? n(ph.codDeclaredMw)  : 0;
    expected    += n(ph.expectedApr26Mw);
  }

  return {
    name:            proj.name,
    poolingStation:  proj.poolingStation?.name ?? '',
    plantTypeLabel:  proj.plantType.label,
    region:          proj.region.code,
    totalCapacityMw: n(proj.totalCapacityMw),
    // Defaults to total capacity when CONTD-4 issued isn't explicitly recorded
    // (consistent with the pipeline matrix + FTC tracker).
    contd4CapacityMw: proj.contd4?.capacityApr26Mw != null ? n(proj.contd4.capacityApr26Mw) : n(proj.totalCapacityMw),
    applied, ftcApproved, tocIssued, codDeclared, expected,
  };
}
