// Shared computation functions for Summary page and Excel export.
// All functions are pure — they take data arrays + optional filter params, return plain objects.

export const REGION_ORDER = ['NR', 'WR', 'SR', 'ER', 'NER'];
export const SOURCE_ORDER = ['WIND', 'SOLAR', 'BESS', 'HYBRID', 'COAL', 'HYDRO', 'PSP'];

export function n(v) { return v != null ? Number(v) : 0; }

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

      const ftcDone = !asOf || (ph.ftcCompletedDate && new Date(ph.ftcCompletedDate) <= asOf);
      row.ftcApprovedMw += ftcDone ? n(ph.ftcCompletedMw) : 0;
      row.ftcPendingMw  += n(ph.capacityUnderFtcMw);

      const tocDone = !asOf || (ph.tocIssuedDate && new Date(ph.tocIssuedDate) <= asOf);
      row.tocIssuedMw += tocDone ? n(ph.tocIssuedMw) : 0;
      row.tocPendingMw += n(ph.capacityUnderTocMw);

      const codDone = !asOf || (ph.codDeclaredDate && new Date(ph.codDeclaredDate) <= asOf);
      const tocVal  = tocDone ? n(ph.tocIssuedMw) : 0;
      const codVal  = codDone ? n(ph.codDeclaredMw) : 0;
      row.codCompletedMw += codVal;
      row.codPendingMw   += Math.max(0, tocVal - codVal);

      row.expectedMw += n(ph.expectedApr26Mw);
    }
  }
  return matrix;
}

export function buildPipelineRows(matrix, primaryKey, secondaryKey) {
  const rows = [];
  const allIndia = emptyPipelineRow('All India', 'All Sources');

  const primaryValues   = primaryKey   === 'region' ? REGION_ORDER : SOURCE_ORDER;
  const secondaryValues = secondaryKey === 'source' ? SOURCE_ORDER : REGION_ORDER;

  for (const pv of primaryValues) {
    const group = [];
    for (const sv of secondaryValues) {
      const key = primaryKey === 'region' ? `${pv}|${sv}` : `${sv}|${pv}`;
      const row = matrix[key];
      if (!row || row.appliedMw + row.totalCapacityMw === 0) continue;
      group.push({ ...row, [primaryKey]: pv, [secondaryKey]: sv });
    }
    if (group.length === 0) continue;
    rows.push(...group);

    // Store pv in the primary key's field so label reads correctly in both pipelines.
    const subtotal = primaryKey === 'region'
      ? emptyPipelineRow(pv, 'Total')   // region=pv, source='Total'
      : emptyPipelineRow('Total', pv);  // region='Total', source=pv
    for (const r of group) {
      subtotal.totalCapacityMw  += r.totalCapacityMw;
      subtotal.contd4CapacityMw += r.contd4CapacityMw;
      subtotal.appliedMw        += r.appliedMw;
      subtotal.ftcApprovedMw    += r.ftcApprovedMw;
      subtotal.ftcPendingMw     += r.ftcPendingMw;
      subtotal.tocIssuedMw      += r.tocIssuedMw;
      subtotal.tocPendingMw     += r.tocPendingMw;
      subtotal.codCompletedMw   += r.codCompletedMw;
      subtotal.codPendingMw     += r.codPendingMw;
      subtotal.expectedMw       += r.expectedMw;
    }
    subtotal.isSubtotal = true;
    rows.push(subtotal);

    for (const f of Object.keys(allIndia)) {
      if (typeof allIndia[f] === 'number') allIndia[f] += subtotal[f];
    }
  }

  allIndia.isTotal = true;
  rows.push(allIndia);
  return rows;
}

// ── Table 1 — CONTD-4 Study ───────────────────────────────────────────────────

export function computeContd4Study(projects) {
  const active = projects.filter(p =>
    p.contd4 && p.contd4.status !== 'CLEARED' && p.contd4.status !== 'REJECTED'
  );

  const matrix = {};
  const allMonthsSet = new Set();

  for (const proj of active) {
    const region = proj.region.code;
    const source = getProjectSource(proj);
    const key    = `${region}|${source}`;
    if (!matrix[key]) matrix[key] = { region, source, totalMw: 0, months: {} };

    matrix[key].totalMw += n(proj.totalCapacityMw);

    const month = proj.contd4.capacityMonth;
    const mw    = n(proj.contd4.capacityApr26Mw);
    if (month && mw) {
      matrix[key].months[month] = (matrix[key].months[month] ?? 0) + mw;
      allMonthsSet.add(month);
    }
  }

  const allMonths = [...allMonthsSet].sort();
  const rows = [];

  for (const region of REGION_ORDER) {
    const regionRows = [];
    for (const source of SOURCE_ORDER) {
      const row = matrix[`${region}|${source}`];
      if (row) regionRows.push(row);
    }
    if (regionRows.length === 0) continue;
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

  const allIndia = { region: 'All India', source: 'All Sources', totalMw: 0, months: {}, isTotal: true };
  for (const r of rows.filter(r => r.isSubtotal)) {
    allIndia.totalMw += r.totalMw;
    for (const m of allMonths) {
      allIndia.months[m] = (allIndia.months[m] ?? 0) + (r.months[m] ?? 0);
    }
  }
  rows.push(allIndia);

  return { rows, allMonths };
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
