'use client';

// BESS Data tab — mirrors the source sheet's "BESS data" table:
//
//   Sr. No | Generating Station | Pooling Station | Plant Type | Region |
//   Total Capacity (MW) | State (situated) | COD declared Capacity (MW) |
//   Energy Commissioned (MWh) | COD Declared in <ref month> (BESS) |
//   COD Date Declared
//
// Two sections: Inter-state BESS (grid-connected — the data already tracked
// in the FTC pipeline) and Intra-state BESS (state-network storage flagged
// via isIntrastate; records COD only). Each section gets a totals row, plus
// a grand Total BESS footer.

// Pure helpers live in a non-'use client' module so the server print page can
// call projectCodDates too. This file only needs the month helpers; other
// consumers import from '@/lib/bess-helpers' directly.
import { monthsInRange, bMonthLabel } from '@/lib/bess-helpers';

const REGION_BADGE = {
  NR: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  WR: 'bg-amber-50 text-amber-700 border-amber-200',
  SR: 'bg-rose-50 text-rose-700 border-rose-200',
  ER: 'bg-teal-50 text-teal-700 border-teal-200',
  NER: 'bg-lime-50 text-lime-700 border-lime-200',
};

export function fmt(v) {
  if (v == null || Number(v) === 0) return '';
  const n = Number(v);
  const parts = n.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const dec = parts[1]?.replace(/0+$/, '');
  return dec ? `${parts[0]}.${dec}` : parts[0];
}

export function fmtDate(d) {
  if (!d) return null;
  try {
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2, '0')}-${String(dt.getMonth() + 1).padStart(2, '0')}-${dt.getFullYear()}`;
  } catch { return null; }
}

const inMonth = (dateStr, ym) => !!(dateStr && ym && String(dateStr).slice(0, 7) === ym);

// The COD-declared dates (YYYY-MM-DD) that back a project's BESS capacity —
// same sources buildRow uses (hybrid BESS component date, else BESS-phase COD
// events). Legacy rows with only cached totals have no date → []. Used by the
// BESS page's COD-date-range filter.
// One display row per project. For hybrids the BESS figures come from the
// project's BESS component (hybridComponentsJson); for plain BESS plants from
// the commissioning phase / COD events.
export function buildRow(p, referenceMonth, range = null) {
  const isHybrid = !!p.plantType?.isHybrid;
  const bessComp = isHybrid
    ? (p.hybridComponentsJson?.components ?? []).find((c) => c.sourceType === 'BESS')
    : null;
  // Which phases hold the BESS figures: for a hybrid, ONLY the BESS-sourced
  // phase(s) (so a Solar+BESS hybrid doesn't show its solar COD here); for a
  // plain BESS plant / intra-state row, all phases (they're all BESS).
  const codPhases = isHybrid ? (p.phases ?? []).filter((ph) => ph.sourceType === 'BESS') : (p.phases ?? []);

  let codDeclared = 0;
  let codInRefMonth = 0;
  let codDateLines = [];
  // Normalised dated COD contributions (MW on a specific date) — drives both
  // the reference-month cell and the COD-date-range breakdown.
  let codDated = [];

  if (isHybrid && bessComp) {
    codDeclared = Number(bessComp.codMw ?? 0);
    if (inMonth(bessComp.codDate, referenceMonth)) codInRefMonth = codDeclared;
    if (bessComp.codDate && codDeclared > 0) {
      codDateLines = [`${fmt(codDeclared)} MW on ${fmtDate(bessComp.codDate)}`];
      codDated = [{ mw: codDeclared, date: bessComp.codDate }];
    }
  } else {
    // No segregation JSON (e.g. a hybrid added via the UI) — derive the BESS
    // figures from the BESS phase's own COD events.
    const events = codPhases.flatMap((ph) => ph.codEvents ?? []);
    if (events.length) {
      const sorted = [...events].sort((a, b) => String(a.eventDate ?? '').localeCompare(String(b.eventDate ?? '')));
      codDeclared   = sorted.reduce((s, e) => s + Number(e.capacityMw ?? 0), 0);
      codInRefMonth = sorted.reduce((s, e) => s + (inMonth(e.eventDate, referenceMonth) ? Number(e.capacityMw ?? 0) : 0), 0);
      codDateLines  = sorted.map((e) => `${fmt(e.capacityMw)} MW on ${fmtDate(e.eventDate)}`);
      codDated      = sorted.map((e) => ({ mw: Number(e.capacityMw ?? 0), date: e.eventDate }));
    } else {
      // Legacy / intra-state rows: cached phase totals, no dated events.
      codDeclared = codPhases.reduce((s, ph) => s + Number(ph.codDeclaredMw ?? 0), 0);
    }
  }

  // Intra-state phase-wise MW override. Intra-state rows record their COD
  // capacity directly in energyPhasesJson ({ mw, mwh, date? }). When present it
  // supersedes the derived figures above: each phase's MW counts toward the
  // COD-declared capacity, dated phases feed the date column / range filter, and
  // a phase with a BLANK date is reflected in the reference-month column by
  // default (per requirement).
  const jsonPhases = Array.isArray(p.energyPhasesJson) ? p.energyPhasesJson : [];
  if (p.isIntrastate) {
    const mwPhases = jsonPhases.filter((ph) => ph?.mw != null && String(ph.mw).trim() !== '');
    if (mwPhases.length) {
      codDeclared = 0; codInRefMonth = 0; codDated = []; codDateLines = [];
      for (const ph of mwPhases) {
        const mw = Number(ph.mw) || 0;
        if (mw <= 0) continue;
        codDeclared += mw;
        const d = ph.date ? String(ph.date).slice(0, 10) : null;
        if (d) {
          codDated.push({ mw, date: d });
          codDateLines.push(`${fmt(mw)} MW on ${fmtDate(d)}`);
          if (inMonth(d, referenceMonth)) codInRefMonth += mw;
        } else {
          // Blank date → reflected in the reference month by default.
          codInRefMonth += mw;
          codDateLines.push(`${fmt(mw)} MW — ${bMonthLabel(referenceMonth)}`);
        }
      }
    }
  }

  // COD declared WITHIN the active date-range filter, split by calendar month
  // (so a range spanning e.g. Jun→Jul reports each month separately).
  let codRangeMonths = null;
  let codInRange = 0;
  if (range && (range.from || range.to)) {
    codRangeMonths = {};
    for (const e of codDated) {
      if (!e.date) continue;
      const d = String(e.date).slice(0, 10);
      if (range.from && d < range.from) continue;
      if (range.to && d > range.to) continue;
      const ym = d.slice(0, 7);
      codRangeMonths[ym] = (codRangeMonths[ym] ?? 0) + e.mw;
      codInRange += e.mw;
    }
  }

  return {
    id: p.id,
    name: p.name,
    poolingStation: p.poolingStation?.name ?? '—',
    plantType: p.plantType?.label ?? '—',
    region: p.region?.code ?? '—',
    totalCapacityMw: Number(p.totalCapacityMw ?? 0),
    stateName: p.stateName ?? '',
    // A hybrid's BESS COD is pipeline-derived (not user-maintained), so the edit
    // modal shows its COD MW read-only even when the row is intra-state.
    isHybrid,
    codDeclared,
    energyMwh: p.energyCommissionedMwh != null ? Number(p.energyCommissionedMwh) : null,
    // Phase-wise energy commissioning ({ mw?, mwh, date, remarks }) for the edit modal.
    energyPhases: Array.isArray(p.energyPhasesJson) ? p.energyPhasesJson : [],
    // The COD commissioning phases (MW + date) as derived from the pipeline —
    // read-only in the edit modal for inter-state rows, which record only the
    // MWh + remarks against each. Dated events when present, else the single
    // undated cached total.
    codPhases: codDated.length
      ? codDated.map((e) => ({ mw: e.mw, date: e.date }))
      : (codDeclared > 0 ? [{ mw: codDeclared, date: null }] : []),
    codInRefMonth,
    codRangeMonths,
    codInRange,
    codDateLines,
  };
}

export function sumRows(rows) {
  const codRangeMonths = {};
  let anyRange = false;
  for (const r of rows) {
    if (r.codRangeMonths) {
      anyRange = true;
      for (const [ym, mw] of Object.entries(r.codRangeMonths)) codRangeMonths[ym] = (codRangeMonths[ym] ?? 0) + mw;
    }
  }
  return rows.reduce(
    (acc, r) => ({
      codDeclared: acc.codDeclared + r.codDeclared,
      energyMwh: acc.energyMwh + (r.energyMwh ?? 0),
      codInRefMonth: acc.codInRefMonth + r.codInRefMonth,
      codInRange: acc.codInRange + (r.codInRange ?? 0),
      codRangeMonths: acc.codRangeMonths,
    }),
    { codDeclared: 0, energyMwh: 0, codInRefMonth: 0, codInRange: 0, codRangeMonths: anyRange ? codRangeMonths : null },
  );
}


// When `editable`, the whole row is a click target that opens the BESS edit
// modal (same interaction as the FTC tracker's clickable rows). The modal —
// not the row — owns which fields can be changed (State, Energy Commissioned).
// The "COD Declared in <month>" cell: the reference-month total by default, or
// — when a COD date-range filter is active — the in-range COD, broken down per
// calendar month when the range spans more than one (rangeMonths.length > 1).
function CodMonthCell({ row, rangeMonths }) {
  if (!rangeMonths) return <>{fmt(row.codInRefMonth)}</>;
  if (rangeMonths.length <= 1) {
    const ym = rangeMonths[0];
    return <>{fmt(row.codRangeMonths?.[ym] ?? 0)}</>;
  }
  const present = rangeMonths.filter((ym) => (row.codRangeMonths?.[ym] ?? 0) > 0);
  if (!present.length) return <span className="text-slate-300">0</span>;
  return (
    <div className="flex flex-col items-center gap-0.5 leading-tight">
      {present.map((ym) => (
        <span key={ym} className="whitespace-nowrap text-[10px]">
          <span className="text-slate-400">{bMonthLabel(ym)}:</span> {fmt(row.codRangeMonths[ym])}
        </span>
      ))}
    </div>
  );
}

function DataRow({ row, sr, intrastate, editable, onEdit, rangeMonths = null }) {
  const clickable = editable && !!onEdit;
  return (
    <tr
      onClick={clickable ? () => onEdit(row) : undefined}
      title={clickable ? (intrastate ? 'Click to edit this intra-state BESS row' : 'Click to edit Energy Commissioned (MWh)') : undefined}
      className={`border-t border-gray-100 transition-colors ${intrastate ? 'bg-yellow-50/60 hover:bg-yellow-50' : 'bg-white hover:bg-blue-50/20'} ${clickable ? 'cursor-pointer' : ''}`}
    >
      <td className="px-2 py-2 text-center text-slate-400">{sr}</td>
      <td className="px-3 py-2 text-center font-medium text-slate-800">{row.name}</td>
      <td className="px-3 py-2 text-center text-slate-600">{row.poolingStation}</td>
      <td className="px-3 py-2 text-center text-slate-600">{row.plantType}</td>
      <td className="px-2 py-2 text-center">
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-bold ${REGION_BADGE[row.region] ?? 'bg-slate-50 text-slate-600 border-slate-200'}`}>
          {row.region}
        </span>
      </td>
      <td className="px-3 py-2 text-center tabular-nums">{fmt(row.totalCapacityMw)}</td>
      <td className="px-3 py-2 text-center text-slate-600">{row.stateName || '—'}</td>
      <td className="px-3 py-2 text-center tabular-nums font-semibold">{fmt(row.codDeclared)}</td>
      <td className="px-3 py-2 text-center tabular-nums">{row.energyMwh != null ? fmt(row.energyMwh) : '—'}</td>
      <td className="px-3 py-2 text-center tabular-nums text-violet-700 font-semibold"><CodMonthCell row={row} rangeMonths={rangeMonths} /></td>
      <td className="px-3 py-2 text-center text-[10px] text-slate-600 leading-relaxed whitespace-nowrap">
        {row.codDateLines.length
          ? row.codDateLines.map((l, i) => <div key={i}>{l}</div>)
          : ''}
      </td>
    </tr>
  );
}

function TotalRow({ label, totals, grand = false, rangeMonths = null }) {
  return (
    <tr className={`border-t ${grand ? 'border-slate-400 bg-slate-200 font-black' : 'border-slate-300 bg-slate-100 font-bold'}`}>
      <td colSpan={7} className="px-3 py-2 text-center text-[10px] uppercase tracking-widest text-slate-600">{label}</td>
      <td className="px-3 py-2 text-center tabular-nums">{fmt(totals.codDeclared)}</td>
      <td className="px-3 py-2 text-center tabular-nums">{totals.energyMwh > 0 ? fmt(totals.energyMwh) : '—'}</td>
      <td className="px-3 py-2 text-center tabular-nums text-violet-800">
        <CodMonthCell row={{ codInRefMonth: totals.codInRefMonth, codRangeMonths: totals.codRangeMonths }} rangeMonths={rangeMonths} />
      </td>
      <td className="px-3 py-2" />
    </tr>
  );
}

// Shared shaping used by both the table and the Excel / PDF exporters: splits
// the projects into inter- / intra-state sections with per-section + grand totals.
export function prepareBessData(bessProjects, referenceMonth, range = null) {
  const rows = (bessProjects ?? []).map((p) => ({ ...buildRow(p, referenceMonth, range), isIntrastate: !!p.isIntrastate }));
  const interstate = rows.filter((r) => !r.isIntrastate);
  const intrastate = rows.filter((r) => r.isIntrastate);
  return {
    rows,
    interstate,
    intrastate,
    interTotals: sumRows(interstate),
    intraTotals: sumRows(intrastate),
    grandTotals: sumRows(rows),
  };
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Cumulative + month-wise BESS COD-commissioning summary, split inter / intra
// state and rolled up to a grand total — mirrors the source sheet's "Total BESS
// commissioned" block. Baseline (A/B) = everything commissioned before the
// current financial year (FY starts in April); then one inter/intra/combined
// row-group per FY month elapsed up to `asOf`, and a grand total.
//
//   A   Total BESS commissioned upto <Mar YYYY> on ISTS        (inter, baseline)
//   B   ...                                          Intra state (intra, baseline)
//   A+B ...                              (inter + Intra state)   (subtotal)
//   C   Total BESS commissioned in <Apr YYYY> on Inter State    …
//   …                                                            grand total
export function computeBessCommissioningSummary(bessProjects, asOf) {
  const now = asOf ? new Date(asOf) : new Date();
  const Y = now.getUTCFullYear();
  const M = now.getUTCMonth();                 // 0-11
  const fyStartYear = M >= 3 ? Y : Y - 1;      // FY starts April (month 3)
  const baselineCutoff = Date.UTC(fyStartYear, 3, 1);
  const nowMs = now.getTime();

  // Collect dated COD entries (mw + inter/intra). Undated cached COD counts
  // toward the baseline (already commissioned, timing unknown).
  const entries = [];
  const add = (date, mw, intra) => { if (mw > 0) entries.push({ ms: date ? new Date(date).getTime() : null, mw, intra }); };
  for (const p of bessProjects ?? []) {
    const intra = !!p.isIntrastate;
    // Intra-state rows record COD capacity phase-wise in energyPhasesJson.
    const jsonMwPhases = intra && Array.isArray(p.energyPhasesJson)
      ? p.energyPhasesJson.filter((ph) => ph?.mw != null && String(ph.mw).trim() !== '')
      : [];
    if (jsonMwPhases.length) {
      for (const ph of jsonMwPhases) add(ph.date ?? null, Number(ph.mw ?? 0), true);
      continue;
    }
    if (p.plantType?.isHybrid) {
      // Hybrid BESS figures: prefer the segregation JSON's BESS component
      // (seeded data); otherwise fall back to the BESS phase's COD events
      // (hybrids added via the UI have no JSON) — mirrors buildRow so the
      // summary stays in step with the table.
      const comp = (p.hybridComponentsJson?.components ?? []).find((c) => c.sourceType === 'BESS');
      if (comp) {
        add(comp.codDate ?? null, Number(comp.codMw ?? 0), intra);
      } else {
        const bessPhases = (p.phases ?? []).filter((ph) => ph.sourceType === 'BESS');
        const events = bessPhases.flatMap((ph) => ph.codEvents ?? []);
        if (events.length) {
          for (const e of events) add(e.eventDate ?? null, Number(e.capacityMw ?? 0), intra);
        } else {
          add(null, bessPhases.reduce((s, ph) => s + Number(ph.codDeclaredMw ?? 0), 0), intra);
        }
      }
    } else {
      const events = (p.phases ?? []).flatMap((ph) => ph.codEvents ?? []);
      if (events.length) {
        for (const e of events) add(e.eventDate ?? null, Number(e.capacityMw ?? 0), intra);
      } else {
        add(null, (p.phases ?? []).reduce((s, ph) => s + Number(ph.codDeclaredMw ?? 0), 0), intra);
      }
    }
  }

  const monthIdxOf = (ms) => { const d = new Date(ms); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
  const startIdx = fyStartYear * 12 + 3;       // April of FY start
  const endIdx = Y * 12 + M;                    // current month

  let baseInter = 0, baseIntra = 0;
  const monthly = {};
  for (let i = startIdx; i <= endIdx; i++) monthly[i] = { inter: 0, intra: 0 };

  for (const e of entries) {
    if (e.ms != null && e.ms > nowMs) continue;          // future COD — not yet commissioned
    if (e.ms == null || e.ms < baselineCutoff) {
      if (e.intra) baseIntra += e.mw; else baseInter += e.mw;
    } else {
      const idx = monthIdxOf(e.ms);
      if (idx < startIdx || idx > endIdx) continue;
      if (e.intra) monthly[idx].intra += e.mw; else monthly[idx].inter += e.mw;
    }
  }

  // Build display rows with A / B / … keys. Every non-grand row carries a
  // `month` group id (the baseline bucket or a FY month) plus `months` lists the
  // groups in order — the print view uses these for its month multi-select filter.
  let li = 0;
  const letter = () => String.fromCharCode(65 + li++);
  const monthLabel = (i) => `${MONTH_NAMES[((i % 12) + 12) % 12]} ${Math.floor(i / 12)}`;
  const singles = [];
  const rows = [];
  const months = [];

  const baseId = `Upto ${monthLabel(startIdx - 1)}`;
  months.push({ id: baseId, label: baseId });
  const aL = letter(), bL = letter();
  singles.push(aL, bL);
  rows.push({ key: aL, month: baseId, label: `Total BESS commissioned upto ${monthLabel(startIdx - 1)} on ISTS`, value: baseInter, kind: 'data' });
  rows.push({ key: bL, month: baseId, label: `Total BESS commissioned upto ${monthLabel(startIdx - 1)} on Intra state`, value: baseIntra, kind: 'data' });
  rows.push({ key: `${aL}+${bL}`, month: baseId, label: `Total BESS commissioned upto ${monthLabel(startIdx - 1)} (inter + Intra state)`, value: baseInter + baseIntra, kind: 'subtotal' });

  for (let i = startIdx; i <= endIdx; i++) {
    const ml = monthLabel(i);
    months.push({ id: ml, label: ml });
    const iL = letter(), jL = letter();
    singles.push(iL, jL);
    rows.push({ key: iL, month: ml, label: `Total BESS commissioned in ${ml} on Inter State`, value: monthly[i].inter, kind: 'data' });
    rows.push({ key: jL, month: ml, label: `Total BESS commissioned in ${ml} on Intra State`, value: monthly[i].intra, kind: 'data' });
    rows.push({ key: `${iL}+${jL}`, month: ml, label: `Total BESS commissioned in ${ml} (inter + Intra state)`, value: monthly[i].inter + monthly[i].intra, kind: 'subtotal' });
  }

  const grand = baseInter + baseIntra + Object.values(monthly).reduce((s, m) => s + m.inter + m.intra, 0);
  rows.push({ key: singles.length <= 16 ? singles.join('+') : 'Σ', month: null, label: 'Total BESS — All-India Commissioned', value: grand, kind: 'grand' });

  return { rows, showKeys: li <= 26, grand, months };
}

// Renders the commissioning summary as a compact table (screen + standalone
// page). The print view renders its own print-styled version from the same
// computeBessCommissioningSummary output.
export function BessCommissioningSummary({ bessProjects, asOf, dateLabel, className = '' }) {
  const { rows, showKeys } = computeBessCommissioningSummary(bessProjects, asOf);
  if (!rows.length) return null;
  return (
    <div className={`rounded-xl border shadow-sm overflow-hidden ${className}`}>
      <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-700">BESS Commissioning Summary</p>
        <p className="text-[10px] text-slate-500 mt-0.5">
          Cumulative &amp; month-wise COD-commissioned BESS capacity (inter + intra-state){dateLabel ? ` — as on ${dateLabel}` : ''}.
        </p>
      </div>
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="bg-slate-100 text-slate-700 text-[10px] border-b border-slate-200">
            {showKeys && <th className="px-2 py-2 text-center font-bold w-12">Key</th>}
            <th className="px-3 py-2 text-left font-bold">Description</th>
            <th className="px-3 py-2 text-right font-bold w-36">Capacity (MW)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              className={
                r.kind === 'grand'
                  ? 'border-t border-slate-400 bg-slate-200 font-black'
                  : r.kind === 'subtotal'
                  ? 'border-t border-slate-200 bg-slate-50 font-semibold'
                  : 'border-t border-gray-100'
              }
            >
              {showKeys && <td className="px-2 py-1.5 text-center text-slate-500 font-mono text-[10px]">{r.key}</td>}
              <td className="px-3 py-1.5 text-slate-700">{r.label}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.value) || '0'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BessDataTab({
  bessProjects,
  referenceMonth,
  refMonthName,
  stickyTopClass = 'top-[156px] lg:top-[166px]',
  // Show the commissioning-summary block under the main table.
  showSummary = true,
  // When true, rows are clickable and call onEditRow(row) to open the edit
  // modal (State / Energy Commissioned — the non-pipeline columns).
  editable = false,
  onEditRow,
  // Active COD-declared date-range filter (YYYY-MM-DD | ''). When set, the
  // "COD Declared in <month>" column follows the filter instead of the global
  // reference month, and breaks the value out per calendar month for a
  // multi-month range.
  fromDate = '',
  toDate = '',
}) {
  const range = (fromDate || toDate) ? { from: fromDate, to: toDate } : null;
  const rangeMonths = range ? monthsInRange(fromDate, toDate) : null;
  const { rows, interstate, intrastate, interTotals, intraTotals, grandTotals } =
    prepareBessData(bessProjects, referenceMonth, range);

  // Column header: the filtered month when a single-month range is active, a
  // generic "by Month" when it spans several, else the global reference month.
  const codMonthHeader = !rangeMonths
    ? `COD Declared in ${refMonthName} (BESS)`
    : rangeMonths.length <= 1
      ? `COD Declared in ${bMonthLabel(rangeMonths[0])} (BESS)`
      : 'COD Declared by Month (BESS)';

  if (!rows.length) {
    return (
      <div className="rounded-xl border shadow-sm p-10 text-center text-sm text-muted-foreground">
        No BESS projects in the current scope.
      </div>
    );
  }

  return (
    <div className="space-y-3">
    <div className="rounded-xl border shadow-sm">
      <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-700">BESS Data — Inter-state &amp; Intra-state</p>
        <p className="text-[10px] text-slate-500 mt-0.5">
          BESS plants and the BESS component of hybrid projects. Inter-state rows come from the FTC pipeline;
          intra-state rows (yellow) are state-network storage with COD only.
        </p>
      </div>
      <div>
        <table className="w-full border-collapse text-[11px]">
          <thead className={`sticky ${stickyTopClass} z-[8]`}>
            <tr className="bg-slate-100 text-slate-700 text-[10px] border-b border-slate-200">
              <th className="px-2 py-2 text-center font-bold whitespace-nowrap w-8">Sr. No</th>
              <th className="px-3 py-2 text-center font-bold whitespace-nowrap">Generating Station</th>
              <th className="px-3 py-2 text-center font-bold whitespace-nowrap">Pooling Station</th>
              <th className="px-3 py-2 text-center font-bold whitespace-nowrap">Plant Type</th>
              <th className="px-2 py-2 text-center font-bold whitespace-nowrap">Region</th>
              <th className="px-3 py-2 text-center font-bold whitespace-nowrap">Total Capacity (MW)</th>
              <th className="px-3 py-2 text-center font-bold whitespace-nowrap">State (situated)</th>
              <th className="px-3 py-2 text-center font-bold whitespace-nowrap">COD declared Capacity (MW)</th>
              <th className="px-3 py-2 text-center font-bold whitespace-nowrap">Energy Commissioned (MWh)</th>
              <th className="px-3 py-2 text-center font-bold whitespace-nowrap bg-violet-50 text-violet-700">{codMonthHeader}</th>
              <th className="px-3 py-2 text-center font-bold whitespace-nowrap">COD Date Declared</th>
            </tr>
          </thead>
          <tbody>
            {interstate.map((row, i) => (
              <DataRow key={row.id} row={row} sr={i + 1} intrastate={false} editable={editable} onEdit={onEditRow} rangeMonths={rangeMonths} />
            ))}
            <TotalRow label="Total — Inter-state BESS" totals={interTotals} rangeMonths={rangeMonths} />
            {intrastate.map((row, i) => (
              <DataRow key={row.id} row={row} sr={i + 1} intrastate editable={editable} onEdit={onEditRow} rangeMonths={rangeMonths} />
            ))}
            {intrastate.length > 0 && <TotalRow label="Total — Intra-state BESS" totals={intraTotals} rangeMonths={rangeMonths} />}
            <TotalRow label="Total BESS" totals={grandTotals} grand rangeMonths={rangeMonths} />
          </tbody>
        </table>
      </div>
    </div>
      {showSummary && <BessCommissioningSummary bessProjects={bessProjects} />}
    </div>
  );
}
