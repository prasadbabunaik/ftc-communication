#!/usr/bin/env node
/**
 * Diff May 12 Excel snapshot against current DB (seeded from May 11).
 * Does NOT mutate — prints a punch list of what changed so the user can
 * apply the deltas via the UI and watch the dashboard converge.
 *
 * Run:  node scripts/diff-may12-vs-db.js
 *
 * Compares:
 *   1. Per-phase legacy totals (capacityAppliedMw, ftcCompletedMw, ftcDate,
 *      tocIssuedMw, tocDate, codDeclaredMw, codDate, expectedApr26Mw,
 *      capacityUnderFtcMw, capacityUnderTocMw).
 *   2. Per-date events (FTC/TOC/COD) — new entries May 12 has vs May 11.
 *   3. CONTD-4 status + capacityApr26Mw.
 *   4. Transmission element pendingFtc + capacityApr26Mva.
 */

require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();
const SEED_NEW   = path.join(__dirname, 'seed-may12.json');
const EVENTS_NEW = path.join(__dirname, 'events-may12.json');

function normalizeName(s) {
  if (!s) return '';
  return String(s).toLowerCase().replace(/[\s.,()\-_/]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const fdate = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '—');
const fnum  = (v) => (v == null ? '—' : Number(v).toFixed(2));
const near = (a, b) => {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) < 0.01;
};
const sameDate = (a, b) => {
  const A = a ? new Date(a).toISOString().slice(0,10) : null;
  const B = b ? new Date(b).toISOString().slice(0,10) : null;
  return A === B;
};

async function main() {
  const newSeed   = JSON.parse(fs.readFileSync(SEED_NEW, 'utf8'));
  const newEvents = JSON.parse(fs.readFileSync(EVENTS_NEW, 'utf8'));

  // Pull DB state
  const projects = await prisma.generationProject.findMany({
    include: {
      region:    true,
      plantType: true,
      contd4:    true,
      phases: {
        include: {
          ftcEvents: { orderBy: { eventDate: 'asc' } },
          tocEvents: { orderBy: { eventDate: 'asc' } },
          codEvents: { orderBy: { eventDate: 'asc' } },
        },
      },
    },
  });
  const txs = await prisma.transmissionElement.findMany({ include: { region: true } });

  const projByKey = new Map();
  for (const p of projects) {
    projByKey.set(`${p.region.code}::${normalizeName(p.name)}`, p);
  }
  const txByKey = new Map();
  for (const t of txs) {
    txByKey.set(`${t.region.code}::${normalizeName(t.elementName)}`, t);
  }
  const newEventByKey = new Map();
  for (const r of newEvents.rows) {
    newEventByKey.set(`${r.region}::${normalizeName(r.name)}`, r);
  }

  const changes = {
    phases:  [],
    events:  [],
    contd4:  [],
    tx:      [],
    new:     [],
    missing: [],
  };

  // ── FTC project / phase comparison ────────────────────────────────────────
  const seenKeys = new Set();
  for (const p of newSeed.ftcProjects) {
    const key = `${p.region}::${normalizeName(p.name)}`;
    seenKeys.add(key);
    const db = projByKey.get(key);
    if (!db) {
      changes.new.push({ region: p.region, name: p.name, totalCapacityMw: p.totalCapacityMw });
      continue;
    }
    const dbPhase = db.phases[0]; // primary phase
    if (!dbPhase) continue;

    for (const ph of p.phases) {
      const diffs = [];
      const cmp = (field, dbVal, newVal, fmt) => {
        if (fmt === 'date') {
          if (!sameDate(dbVal, newVal)) {
            diffs.push(`${field}: ${fdate(dbVal)} → ${fdate(newVal)}`);
          }
        } else if (!near(dbVal, newVal)) {
          diffs.push(`${field}: ${fnum(dbVal)} → ${fnum(newVal)}`);
        }
      };
      cmp('Applied',         dbPhase.capacityAppliedMw, ph.capacityAppliedMw);
      cmp('FTC Total',       dbPhase.ftcCompletedMw,    ph.ftcCompletedMw);
      cmp('FTC Date',        dbPhase.ftcCompletedDate,  ph.ftcCompletedDate, 'date');
      cmp('TOC Total',       dbPhase.tocIssuedMw,       ph.tocIssuedMw);
      cmp('TOC Date',        dbPhase.tocIssuedDate,     ph.tocIssuedDate,    'date');
      cmp('COD Total',       dbPhase.codDeclaredMw,     ph.codDeclaredMw);
      cmp('COD Date',        dbPhase.codDeclaredDate,   ph.codDeclaredDate,  'date');
      cmp('Under FTC',       dbPhase.capacityUnderFtcMw, ph.capacityUnderFtcMw);
      cmp('Under TOC',       dbPhase.capacityUnderTocMw, ph.capacityUnderTocMw);
      cmp('Expected (Apr)',  dbPhase.expectedApr26Mw,    ph.expectedApr26Mw);
      cmp('Proposed FTC',    dbPhase.proposedFtcDate,    ph.proposedFtcDate,  'date');
      if (diffs.length) {
        changes.phases.push({ region: p.region, name: p.name, sourceType: ph.sourceType, diffs });
      }
    }

    // Per-date events
    const newRow = newEventByKey.get(key);
    if (newRow) {
      const cmpEvents = (kind, dbEvs, newEvs) => {
        const dbSet = new Set(dbEvs.map((e) => `${new Date(e.eventDate).toISOString().slice(0,10)}|${Number(e.capacityMw).toFixed(2)}`));
        const added = [];
        const removed = [];
        for (const e of newEvs) {
          const key2 = `${e.date}|${e.mw.toFixed(2)}`;
          if (!dbSet.has(key2)) added.push({ date: e.date, mw: e.mw, fragment: e.fragment });
        }
        const newSet = new Set(newEvs.map((e) => `${e.date}|${e.mw.toFixed(2)}`));
        for (const e of dbEvs) {
          const key2 = `${new Date(e.eventDate).toISOString().slice(0,10)}|${Number(e.capacityMw).toFixed(2)}`;
          if (!newSet.has(key2)) removed.push({ date: new Date(e.eventDate).toISOString().slice(0,10), mw: Number(e.capacityMw) });
        }
        if (added.length || removed.length) {
          changes.events.push({ region: p.region, name: p.name, kind, added, removed });
        }
      };
      cmpEvents('FTC', dbPhase.ftcEvents, newRow.ftc_events);
      cmpEvents('TOC', dbPhase.tocEvents, newRow.toc_events);
      cmpEvents('COD', dbPhase.codEvents, newRow.cod_events);
    }
  }

  // ── CONTD-4 comparison ────────────────────────────────────────────────────
  for (const p of newSeed.contd4Projects) {
    const key = `${p.region}::${normalizeName(p.name)}`;
    const db = projByKey.get(key);
    if (!db || !db.contd4) continue;
    const diffs = [];
    if (!near(db.contd4.capacityApr26Mw, p.capacityApr26Mw)) {
      diffs.push(`Capacity (Apr26): ${fnum(db.contd4.capacityApr26Mw)} → ${fnum(p.capacityApr26Mw)}`);
    }
    if ((db.contd4.capacityMonth || null) !== (p.capacityMonth || null)) {
      diffs.push(`Capacity Month: ${db.contd4.capacityMonth || '—'} → ${p.capacityMonth || '—'}`);
    }
    if (!sameDate(db.contd4.proposedFtcDate, p.proposedFtcDate)) {
      diffs.push(`Proposed FTC: ${fdate(db.contd4.proposedFtcDate)} → ${fdate(p.proposedFtcDate)}`);
    }
    if ((db.contd4.remarks || '') !== (p.remarks || '')) {
      diffs.push(`Remarks: "${(db.contd4.remarks || '').slice(0, 60)}" → "${(p.remarks || '').slice(0, 60)}"`);
    }
    if (diffs.length) {
      changes.contd4.push({ region: p.region, name: p.name, diffs });
    }
  }

  // ── Transmission comparison ───────────────────────────────────────────────
  const seenTxKeys = new Set();
  for (const t of newSeed.transElements) {
    const key = `${t.region}::${normalizeName(t.elementName)}`;
    seenTxKeys.add(key);
    const db = txByKey.get(key);
    if (!db) {
      changes.new.push({ region: t.region, name: '[TX] ' + t.elementName, totalCapacityMw: t.capacityMva });
      continue;
    }
    const diffs = [];
    if (db.pendingFtc !== t.pendingFtc) {
      diffs.push(`Pending FTC: ${db.pendingFtc} → ${t.pendingFtc}`);
    }
    if (!near(db.capacityApr26Mva, t.capacityApr26Mva)) {
      diffs.push(`Capacity Apr26: ${fnum(db.capacityApr26Mva)} → ${fnum(t.capacityApr26Mva)}`);
    }
    if (!near(db.lineLengthApr26Km, t.lineLengthApr26Km)) {
      diffs.push(`Length Apr26: ${fnum(db.lineLengthApr26Km)} → ${fnum(t.lineLengthApr26Km)}`);
    }
    if (!sameDate(db.firstEnergyDate, t.firstEnergyDate)) {
      diffs.push(`First Energy Date: ${fdate(db.firstEnergyDate)} → ${fdate(t.firstEnergyDate)}`);
    }
    if (!sameDate(db.proposedFtcDate, t.proposedFtcDate)) {
      diffs.push(`Proposed FTC Date: ${fdate(db.proposedFtcDate)} → ${fdate(t.proposedFtcDate)}`);
    }
    if ((db.remarks || '') !== (t.remarks || '')) {
      diffs.push(`Remarks: "${(db.remarks || '').slice(0, 60)}" → "${(t.remarks || '').slice(0, 60)}"`);
    }
    if (diffs.length) changes.tx.push({ region: t.region, name: t.elementName, diffs });
  }

  // ── Render report ─────────────────────────────────────────────────────────
  const print = (title, items, renderItem) => {
    console.log(`\n══ ${title} (${items.length}) ══`);
    items.forEach(renderItem);
  };

  print('Phase legacy-field changes', changes.phases, (c) => {
    console.log(`  ▸ ${c.region} · ${c.name} · ${c.sourceType}`);
    c.diffs.forEach((d) => console.log(`     ${d}`));
  });

  print('Per-date event additions/removals', changes.events, (c) => {
    console.log(`  ▸ ${c.region} · ${c.name} · ${c.kind}`);
    c.added.forEach((e)  => console.log(`     + ADD    ${e.date}  ${e.mw.toFixed(2)} MW   (${e.fragment.slice(0, 60)})`));
    c.removed.forEach((e) => console.log(`     − REMOVE ${e.date}  ${e.mw.toFixed(2)} MW   (in DB but not in May 12)`));
  });

  print('CONTD-4 changes', changes.contd4, (c) => {
    console.log(`  ▸ ${c.region} · ${c.name}`);
    c.diffs.forEach((d) => console.log(`     ${d}`));
  });

  print('Transmission element changes', changes.tx, (c) => {
    console.log(`  ▸ ${c.region} · ${c.name}`);
    c.diffs.forEach((d) => console.log(`     ${d}`));
  });

  print('NEW rows in May 12 not present in DB', changes.new, (c) => {
    console.log(`  ▸ ${c.region} · ${c.name}  (~${fnum(c.totalCapacityMw)} MW)`);
  });

  // Project / TX rows in DB but absent from May 12 = deactivation candidates
  const allMay12Keys = new Set(newSeed.ftcProjects.concat(newSeed.contd4Projects).map(p => `${p.region}::${normalizeName(p.name)}`));
  const missingProjects = [];
  for (const p of projects) {
    const key = `${p.region.code}::${normalizeName(p.name)}`;
    if (!allMay12Keys.has(key)) missingProjects.push({ region: p.region.code, name: p.name });
  }
  print('Projects in DB but NOT in May 12 (dropout candidates)', missingProjects, (c) => {
    console.log(`  ▸ ${c.region} · ${c.name}`);
  });

  console.log(`\n══ Summary ══`);
  console.log(`  Phase legacy diffs:  ${changes.phases.length}`);
  console.log(`  Event diffs:         ${changes.events.length} rows  (added/removed entries inside)`);
  console.log(`  CONTD-4 diffs:       ${changes.contd4.length}`);
  console.log(`  Transmission diffs:  ${changes.tx.length}`);
  console.log(`  New rows in May 12:  ${changes.new.length}`);
  console.log(`  Dropout candidates:  ${missingProjects.length}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
