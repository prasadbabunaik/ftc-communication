// Rolling 3-month expected-commissioning forecast with monthly carry-forward.
//
// Each CommissioningPhase stores an operator-entered map of expected MW by
// absolute month (expectedMonthlyJson, e.g. { "2026-07": 37.5, "2026-08": 50 }).
// The operator edits the current month + the next two; earlier months persist.
// Any UNMET quantum in a month — expected(after carry) minus the MW actually
// COD-commissioned that month — carries into the following month. This is
// computed live off the calendar (no cron): as months pass, past shortfalls
// roll into the current month automatically.
//
// Pure functions — take a phase-like object, return plain values.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const num = (v) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
const r2  = (x) => Math.round(x * 100) / 100;

export function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
export function monthKeyOf(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
export function monthLabel(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return `${MONTHS[Number(m) - 1]}'${String(y).slice(2)}`;
}
// The three editable months: current, current+1, current+2.
export function threeMonths(refMonth) {
  return [refMonth, addMonths(refMonth, 1), addMonths(refMonth, 2)];
}

// Operator-entered expected per absolute month → { 'YYYY-MM': mw } (mw > 0 only).
export function expectedMonthlyOf(phase) {
  const j = phase?.expectedMonthlyJson;
  if (j && typeof j === 'object' && !Array.isArray(j)) {
    const out = {};
    for (const [k, v] of Object.entries(j)) {
      if (/^\d{4}-\d{2}$/.test(k) && num(v) > 0) out[k] = num(v);
    }
    return out;
  }
  // Legacy fallback: single expectedMonth + expectedApr26Mw.
  const mw = num(phase?.expectedApr26Mw);
  const m = phase?.expectedMonth;
  if (mw > 0 && m && /^\d{4}-\d{2}$/.test(m)) return { [m]: mw };
  return {};
}

// Actual COD commissioned per absolute month → { 'YYYY-MM': mw }.
export function codByMonth(phase) {
  const out = {};
  const events = phase?.codEvents ?? [];
  if (events.length) {
    for (const e of events) {
      const m = monthKeyOf(e.eventDate);
      if (m) out[m] = (out[m] ?? 0) + num(e.capacityMw);
    }
    return out;
  }
  const mw = num(phase?.codDeclaredMw);
  const m = phase?.codDeclaredDate ? monthKeyOf(phase.codDeclaredDate) : null;
  if (mw > 0 && m) out[m] = mw;
  return out;
}

// Roll unmet expected forward month-by-month up to (and including) refMonth.
// Returns the carry ENTERING refMonth and the effective expected AT refMonth
// (the operator's refMonth entry plus that carry).
export function rollForwardTo(expectedMap, codMap, refMonth) {
  const keys = [...Object.keys(expectedMap), ...Object.keys(codMap)].filter((m) => m <= refMonth).sort();
  if (keys.length === 0) {
    return { carriedInto: 0, effective: r2(num(expectedMap[refMonth])) };
  }
  let carry = 0;
  let carriedIntoRef = 0;
  for (let m = keys[0]; m <= refMonth; m = addMonths(m, 1)) {
    if (m === refMonth) carriedIntoRef = carry;
    const eff = num(expectedMap[m]) + carry;
    carry = Math.max(0, eff - num(codMap[m]));
  }
  return { carriedInto: r2(carriedIntoRef), effective: r2(num(expectedMap[refMonth]) + carriedIntoRef) };
}

export function carriedIntoMonth(phase, refMonth) {
  return rollForwardTo(expectedMonthlyOf(phase), codByMonth(phase), refMonth).carriedInto;
}
export function effectiveExpectedForMonth(phase, refMonth) {
  return rollForwardTo(expectedMonthlyOf(phase), codByMonth(phase), refMonth).effective;
}

// Mutates fetched phases in place so downstream consumers that sum
// `expectedApr26Mw` show the effective current-month expected (entered +
// carried-forward). Stamps for the editor:
//   _expectedMonthly  raw operator entries { 'YYYY-MM': mw }
//   _carriedExpected  MW carried into refMonth from earlier unmet months
// Reads the raw fields BEFORE overwriting expectedApr26Mw, so legacy phases
// (no expectedMonthlyJson) resolve correctly.
export function applyExpectedForecast(projects, refMonth) {
  for (const p of projects ?? []) {
    for (const ph of p.phases ?? []) {
      const rawMonthly = expectedMonthlyOf(ph);
      const { carriedInto, effective } = rollForwardTo(rawMonthly, codByMonth(ph), refMonth);
      ph._expectedMonthly = rawMonthly;
      ph._carriedExpected = carriedInto;
      ph.expectedApr26Mw  = effective;
    }
  }
  return projects;
}
