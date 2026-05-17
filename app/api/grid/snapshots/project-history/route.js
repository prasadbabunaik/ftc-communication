import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireServerUser } from '@/lib/server-auth';

const ROLE_REGION_MAP = { SRLDC: 'SR', NRLDC: 'NR', ERLDC: 'ER', WRLDC: 'WR', NERLDC: 'NER' };

/**
 * GET /api/grid/snapshots/project-history?name=...&region=...&kind=ftc|contd4|tx
 *
 * Returns a time series of per-day per-project (or per-tx-element) snapshots
 * for a single project, used by the detail modals to render day-wise history.
 *
 * Response shape:
 *   { snapshots: [
 *       { date: '2026-04-23', label: '...', match: <full row> | null },
 *       ...
 *   ] }
 */
export async function GET(request) {
  try {
    const user = await requireServerUser(request);
    const url    = new URL(request.url);
    const name   = (url.searchParams.get('name')   || '').trim();
    const region = (url.searchParams.get('region') || '').trim();
    const kind   = (url.searchParams.get('kind')   || 'ftc').trim();

    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

    // Region scope: an xRLDC user may only inspect projects/elements in their
    // own region — block cross-region history queries.
    const ownRegionCode = ROLE_REGION_MAP[user.role];
    if (ownRegionCode && region && region !== ownRegionCode) {
      return NextResponse.json({ error: 'Forbidden — cross-region access denied' }, { status: 403 });
    }
    // If the user is an xRLDC and no region was supplied, auto-restrict to their own.
    const effectiveRegion = ownRegionCode || region;

    // Query without an explicit select so older Prisma clients (no detailsJson
    // field in the generated types) don't reject the query at runtime.
    const snapshots = await prisma.gridSnapshot.findMany({
      orderBy: { snapshotDate: 'asc' },
    });

    const collection = kind === 'contd4' ? 'contd4' : kind === 'tx' ? 'tx' : 'projects';
    const nameField  = kind === 'tx' ? 'elementName' : 'name';
    const needle     = name.toLowerCase();

    const series = snapshots.map((s) => {
      const details = s.detailsJson ?? null;
      const list    = details ? (details[collection] || []) : [];
      const match = list.find(
        (r) => String(r?.[nameField] ?? '').toLowerCase() === needle
          && (!effectiveRegion || r?.region === effectiveRegion),
      ) || null;
      const dateStr = s.snapshotDate instanceof Date
        ? s.snapshotDate.toISOString().slice(0, 10)
        : String(s.snapshotDate).slice(0, 10);
      return { date: dateStr, label: s.label, match };
    });

    return NextResponse.json({ snapshots: series });
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // Surface the actual error message to the client to make diagnosis easier.
    console.error('[project-history] error:', e);
    return NextResponse.json({ error: e.message || 'Internal error', stack: process.env.NODE_ENV === 'development' ? e.stack : undefined }, { status: 500 });
  }
}
