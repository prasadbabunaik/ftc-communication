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

export function n(v) { return v != null ? Number(v) : 0; }

// Returns the milestone capacity (FTC / TOC / COD) for a phase as-of a given
// date. Strategy:
//   1. If `asOf` is null → use the cached aggregate (full current state).
//   2. If `asOf` is set AND the phase has per-event rows → sum events whose
//      eventDate ≤ asOf. This is the source of truth for point-in-time.
//   3. Otherwise → fall back to the cached aggregate, gated by the single
//      legacy completion date on the phase (all-or-nothing).
function milestoneAsOf(events, asOf, fallbackDate, fallbackMw) {
  if (!asOf) return n(fallbackMw);
  if (events && events.length > 0) {
    let sum = 0;
    for (const e of events) {
      if (new Date(e.eventDate) <= asOf) sum += n(e.capacityMw);
    }
    return sum;
  }
  return fallbackDate && new Date(fallbackDate) <= asOf ? n(fallbackMw) : 0;
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

export function computePipelineMatrix(projects, asOf = null) {
  const matrix = {};
  const cleared = projects.filter(p => p.contd4?.status === 'CLEARED');

  for (const proj of cleared) {
    const region = proj.region.code;
    const source = getProjectSource(proj);
    const key    = `${region}|${source}`;

    if (!matrix[key]) matrix[key] = emptyPipelineRow(region, source);
    const row = matrix[key];

    row.totalCapacityMw  += n(proj.totalCapacityMw);
    row.contd4CapacityMw += n(proj.contd4?.capacityApr26Mw);

    for (const ph of proj.phases) {
      row.appliedMw += n(ph.capacityAppliedMw);

      // Date-gated milestone totals. When `asOf` is set we prefer per-event
      // sums (true point-in-time view); when no asOf is set or the phase has
      // no events we fall back to the cached totals.
      const ftcVal = milestoneAsOf(ph.ftcEvents, asOf, ph.ftcCompletedDate, ph.ftcCompletedMw);
      const tocVal = milestoneAsOf(ph.tocEvents, asOf, ph.tocIssuedDate,    ph.tocIssuedMw);
      const codVal = milestoneAsOf(ph.codEvents, asOf, ph.codDeclaredDate,  ph.codDeclaredMw);

      row.ftcApprovedMw += ftcVal;
      row.ftcPendingMw  += n(ph.capacityUnderFtcMw);

      row.tocIssuedMw   += tocVal;
      row.tocPendingMw  += n(ph.capacityUnderTocMw);

      row.codCompletedMw += codVal;
      row.codPendingMw   += ph.capacityPendingCodMw != null
        ? n(ph.capacityPendingCodMw)
        : Math.max(0, tocVal - codVal - n(ph.capacityUnderTocMw));

      row.expectedMw += n(ph.expectedApr26Mw);
    }
  }
  return matrix;
}

const PIPELINE_NUMERIC_FIELDS = [
  'totalCapacityMw', 'contd4CapacityMw', 'appliedMw',
  'ftcApprovedMw', 'ftcPendingMw',
  'tocIssuedMw', 'tocPendingMw',
  'codCompletedMw', 'codPendingMw', 'expectedMw',
];

export function buildPipelineRows(matrix, primaryKey, secondaryKey) {
  const rows = [];
  const allIndia = emptyPipelineRow('All India', 'Total');

  const primaryValues   = primaryKey   === 'region' ? REGION_ORDER : SOURCE_ORDER;
  const secondaryValues = secondaryKey === 'source' ? SOURCE_ORDER : REGION_ORDER;

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
      if (row && (row.appliedMw + row.totalCapacityMw > 0)) hasAnyData = true;
      const baseRegion = primaryKey === 'region' ? pv : sv;
      const baseSource = secondaryKey === 'source' ? sv : pv;
      group.push({ ...(row ?? emptyPipelineRow(baseRegion, baseSource)), [primaryKey]: pv, [secondaryKey]: sv });
    }
    if (!hasAnyData) continue; // skip regions/sources that have absolutely no data
    rows.push(...group);

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
    rows.push(subtotal);

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
  const sourcesToShow = [...baseSources, ...extraSources];

  const allMonths = [...allMonthsSet].sort();
  const rows = [];

  for (const region of REGION_ORDER) {
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

  // All India breakdown: one row per source aggregating across all regions,
  // followed by a grand-total row (matches Excel R27-R33 layout).
  for (const source of sourcesToShow) {
    const aggRow = { region: 'All India', source, totalMw: 0, months: {}, isAllIndiaBreakdown: true };
    for (const region of REGION_ORDER) {
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
  for (const r of rows.filter(r => r.isSubtotal)) {
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

export function computeHybridBreakdown(projects, asOf = null) {
  const cleared = projects.filter(p => p.contd4?.status === 'CLEARED' && p.plantType.isHybrid);
  const matrix  = {};

  for (const proj of cleared) {
    const region     = proj.region.code;
    const hybridType = proj.plantType.label;

    for (const ph of proj.phases) {
      const key = `${region}|${hybridType}|${ph.sourceType}`;
      if (!matrix[key]) {
        matrix[key] = {
          region, hybridType, sourceType: ph.sourceType,
          totalMw: 0, appliedMw: 0, ftcMw: 0, tocMw: 0, codMw: 0, expectedMw: 0,
        };
      }
      const row = matrix[key];
      row.appliedMw  += n(ph.capacityAppliedMw);

      const ftcDone = !asOf || (ph.ftcCompletedDate && new Date(ph.ftcCompletedDate) <= asOf);
      row.ftcMw      += ftcDone ? n(ph.ftcCompletedMw) : 0;

      const tocDone = !asOf || (ph.tocIssuedDate && new Date(ph.tocIssuedDate) <= asOf);
      row.tocMw      += tocDone ? n(ph.tocIssuedMw) : 0;

      const codDone = !asOf || (ph.codDeclaredDate && new Date(ph.codDeclaredDate) <= asOf);
      row.codMw      += codDone ? n(ph.codDeclaredMw) : 0;
      row.expectedMw += n(ph.expectedApr26Mw);
    }

    const srcCaps = { WIND: n(proj.windCapacityMw), SOLAR: n(proj.solarCapacityMw), BESS: n(proj.bessCapacityMw) };
    for (const [src, cap] of Object.entries(srcCaps)) {
      if (cap > 0) {
        const key = `${region}|${hybridType}|${src}`;
        if (matrix[key]) matrix[key].totalMw += cap;
      }
    }
  }

  return Object.values(matrix).sort((a, b) => {
    const ri = REGION_ORDER.indexOf(a.region) - REGION_ORDER.indexOf(b.region);
    if (ri !== 0) return ri;
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

// ── Table 6 — Monthly COD ─────────────────────────────────────────────────────

export function computeMonthlyCod(projects, fromMonth = null, toMonth = null) {
  const months  = buildCodMonths(fromMonth, toMonth);
  const cleared = projects.filter(p => p.contd4?.status === 'CLEARED');
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

  for (const ph of proj.phases) {
    applied += n(ph.capacityAppliedMw);

    const ftcDone = !asOf || (ph.ftcCompletedDate && new Date(ph.ftcCompletedDate) <= asOf);
    ftcApproved += ftcDone ? n(ph.ftcCompletedMw) : 0;

    const tocDone = !asOf || (ph.tocIssuedDate && new Date(ph.tocIssuedDate) <= asOf);
    tocIssued   += tocDone ? n(ph.tocIssuedMw) : 0;

    const codDone = !asOf || (ph.codDeclaredDate && new Date(ph.codDeclaredDate) <= asOf);
    codDeclared += codDone ? n(ph.codDeclaredMw) : 0;
    expected    += n(ph.expectedApr26Mw);
  }

  return {
    name:            proj.name,
    poolingStation:  proj.poolingStation?.name ?? '',
    plantTypeLabel:  proj.plantType.label,
    region:          proj.region.code,
    totalCapacityMw: n(proj.totalCapacityMw),
    contd4CapacityMw: n(proj.contd4?.capacityApr26Mw),
    applied, ftcApproved, tocIssued, codDeclared, expected,
  };
}
