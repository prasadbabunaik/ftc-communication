// Pure BESS helper functions shared by BOTH the client table/exports
// (components/grid/BessDataTab.jsx, 'use client') AND the server print page
// (app/(print)/bess-data/print/page.jsx). Kept here — free of 'use client' —
// so the server can call them; a server component can't invoke a function that
// lives in a client module.

// Normalise a Date object (server/print context) or an ISO string (serialised
// client props) to a comparable YYYY-MM-DD string. Returns null if unparseable.
export function toYmd(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// The COD-declared dates (YYYY-MM-DD) that back a project's BESS capacity —
// same sources buildRow uses (hybrid BESS component date, else BESS-phase COD
// events). Legacy rows with only cached totals have no date → []. Used by the
// BESS page's COD-date-range filter.
export function projectCodDates(p) {
  const isHybrid = !!p.plantType?.isHybrid;
  const bessComp = isHybrid
    ? (p.hybridComponentsJson?.components ?? []).find((c) => c.sourceType === 'BESS')
    : null;
  const codPhases = isHybrid ? (p.phases ?? []).filter((ph) => ph.sourceType === 'BESS') : (p.phases ?? []);
  const dates = [];
  if (isHybrid && bessComp) {
    const ymd = toYmd(bessComp.codDate);
    if (ymd && Number(bessComp.codMw ?? 0) > 0) dates.push(ymd);
  } else {
    for (const ph of codPhases) {
      for (const e of ph.codEvents ?? []) {
        const ymd = toYmd(e.eventDate);
        if (ymd && Number(e.capacityMw ?? 0) > 0) dates.push(ymd);
      }
    }
  }
  return dates;
}

// Calendar months (YYYY-MM) spanned by a [from, to] range, inclusive. Either
// bound may be blank (open-ended); falls back to the other bound's month.
export function monthsInRange(from, to) {
  const a = (from || to || '').slice(0, 7);
  const b = (to || from || '').slice(0, 7);
  if (!a || !b) return [];
  const out = [];
  let [y, m] = a.split('-').map(Number);
  const [ey, em] = b.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

// "2026-06" → "Jun'26".
export function bMonthLabel(ym) {
  if (!ym) return '';
  try {
    const d = new Date(`${ym}-01T00:00:00`);
    return `${d.toLocaleString('en-US', { month: 'short' })}'${String(d.getFullYear()).slice(2)}`;
  } catch { return ym; }
}
