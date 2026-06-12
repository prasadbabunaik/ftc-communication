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

const REGION_BADGE = {
  NR: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  WR: 'bg-amber-50 text-amber-700 border-amber-200',
  SR: 'bg-rose-50 text-rose-700 border-rose-200',
  ER: 'bg-teal-50 text-teal-700 border-teal-200',
  NER: 'bg-lime-50 text-lime-700 border-lime-200',
};

function fmt(v) {
  if (v == null || Number(v) === 0) return '';
  const n = Number(v);
  const parts = n.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const dec = parts[1]?.replace(/0+$/, '');
  return dec ? `${parts[0]}.${dec}` : parts[0];
}

function fmtDate(d) {
  if (!d) return null;
  try {
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2, '0')}-${String(dt.getMonth() + 1).padStart(2, '0')}-${dt.getFullYear()}`;
  } catch { return null; }
}

const inMonth = (dateStr, ym) => !!(dateStr && ym && String(dateStr).slice(0, 7) === ym);

// One display row per project. For hybrids the BESS figures come from the
// project's BESS component (hybridComponentsJson); for plain BESS plants from
// the commissioning phase / COD events.
function buildRow(p, referenceMonth) {
  const isHybrid = !!p.plantType?.isHybrid;
  const bessComp = isHybrid
    ? (p.hybridComponentsJson?.components ?? []).find((c) => c.sourceType === 'BESS')
    : null;

  let codDeclared = 0;
  let codInRefMonth = 0;
  let codDateLines = [];

  if (isHybrid && bessComp) {
    codDeclared = Number(bessComp.codMw ?? 0);
    if (inMonth(bessComp.codDate, referenceMonth)) codInRefMonth = codDeclared;
    if (bessComp.codDate && codDeclared > 0) {
      codDateLines = [`${fmt(codDeclared)} MW on ${fmtDate(bessComp.codDate)}`];
    }
  } else {
    const events = (p.phases ?? []).flatMap((ph) => ph.codEvents ?? []);
    if (events.length) {
      const sorted = [...events].sort((a, b) => String(a.eventDate ?? '').localeCompare(String(b.eventDate ?? '')));
      codDeclared   = sorted.reduce((s, e) => s + Number(e.capacityMw ?? 0), 0);
      codInRefMonth = sorted.reduce((s, e) => s + (inMonth(e.eventDate, referenceMonth) ? Number(e.capacityMw ?? 0) : 0), 0);
      codDateLines  = sorted.map((e) => `${fmt(e.capacityMw)} MW on ${fmtDate(e.eventDate)}`);
    } else {
      // Legacy / intra-state rows: cached phase totals, no dated events.
      codDeclared = (p.phases ?? []).reduce((s, ph) => s + Number(ph.codDeclaredMw ?? 0), 0);
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
    codDeclared,
    energyMwh: p.energyCommissionedMwh != null ? Number(p.energyCommissionedMwh) : null,
    codInRefMonth,
    codDateLines,
  };
}

function sumRows(rows) {
  return rows.reduce(
    (acc, r) => ({
      codDeclared: acc.codDeclared + r.codDeclared,
      energyMwh: acc.energyMwh + (r.energyMwh ?? 0),
      codInRefMonth: acc.codInRefMonth + r.codInRefMonth,
    }),
    { codDeclared: 0, energyMwh: 0, codInRefMonth: 0 },
  );
}

function DataRow({ row, sr, intrastate }) {
  return (
    <tr className={`border-t border-gray-100 transition-colors ${intrastate ? 'bg-yellow-50/60 hover:bg-yellow-50' : 'bg-white hover:bg-blue-50/20'}`}>
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
      <td className="px-3 py-2 text-center tabular-nums text-violet-700 font-semibold">{fmt(row.codInRefMonth)}</td>
      <td className="px-3 py-2 text-center text-[10px] text-slate-600 leading-relaxed whitespace-nowrap">
        {row.codDateLines.length
          ? row.codDateLines.map((l, i) => <div key={i}>{l}</div>)
          : ''}
      </td>
    </tr>
  );
}

function TotalRow({ label, totals, grand = false }) {
  return (
    <tr className={`border-t ${grand ? 'border-slate-400 bg-slate-200 font-black' : 'border-slate-300 bg-slate-100 font-bold'}`}>
      <td colSpan={7} className="px-3 py-2 text-center text-[10px] uppercase tracking-widest text-slate-600">{label}</td>
      <td className="px-3 py-2 text-center tabular-nums">{fmt(totals.codDeclared)}</td>
      <td className="px-3 py-2 text-center tabular-nums">{totals.energyMwh > 0 ? fmt(totals.energyMwh) : '—'}</td>
      <td className="px-3 py-2 text-center tabular-nums text-violet-800">{totals.codInRefMonth > 0 ? fmt(totals.codInRefMonth) : '0'}</td>
      <td className="px-3 py-2" />
    </tr>
  );
}

export function BessDataTab({ bessProjects, referenceMonth, refMonthName }) {
  const rows = (bessProjects ?? []).map((p) => ({ ...buildRow(p, referenceMonth), isIntrastate: !!p.isIntrastate }));

  const interstate = rows.filter((r) => !r.isIntrastate);
  const intrastate = rows.filter((r) => r.isIntrastate);
  const interTotals = sumRows(interstate);
  const intraTotals = sumRows(intrastate);
  const grandTotals = sumRows(rows);

  if (!rows.length) {
    return (
      <div className="rounded-xl border shadow-sm p-10 text-center text-sm text-muted-foreground">
        No BESS projects in the current scope.
      </div>
    );
  }

  return (
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
          <thead className="sticky top-[156px] lg:top-[166px] z-[8]">
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
              <th className="px-3 py-2 text-center font-bold whitespace-nowrap bg-violet-50 text-violet-700">COD Declared in {refMonthName} (BESS)</th>
              <th className="px-3 py-2 text-center font-bold whitespace-nowrap">COD Date Declared</th>
            </tr>
          </thead>
          <tbody>
            {interstate.map((row, i) => (
              <DataRow key={row.id} row={row} sr={i + 1} intrastate={false} />
            ))}
            <TotalRow label="Total — Inter-state BESS" totals={interTotals} />
            {intrastate.map((row, i) => (
              <DataRow key={row.id} row={row} sr={i + 1} intrastate />
            ))}
            {intrastate.length > 0 && <TotalRow label="Total — Intra-state BESS" totals={intraTotals} />}
            <TotalRow label="Total BESS" totals={grandTotals} grand />
          </tbody>
        </table>
      </div>
    </div>
  );
}
