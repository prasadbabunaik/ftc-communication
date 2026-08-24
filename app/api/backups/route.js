import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { requireServerUser, isAdmin } from '@/lib/server-auth';
import { prisma } from '@/lib/prisma';
import { BACKUP_DIR, STALE_RUN_MS } from '@/lib/backup';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  let user;
  try { user = await requireServerUser(); }
  catch { return { error: NextResponse.json({ error: 'Session expired.' }, { status: 401 }) }; }
  if (!isAdmin(user.role)) return { error: NextResponse.json({ error: 'Administrator access required.' }, { status: 403 }) };
  return { user };
}

// Flip runs stuck in RUNNING (crashed process / restart mid-dump) to FAILED so
// the history is honest and a new backup isn't blocked forever.
async function reapStaleRuns() {
  const cutoff = new Date(Date.now() - STALE_RUN_MS);
  await prisma.backupRun.updateMany({
    where: { status: 'RUNNING', startedAt: { lt: cutoff } },
    data: { status: 'FAILED', finishedAt: new Date(), error: 'Timed out — the backup process did not finish (server restart or crash).' },
  });
}

function serialize(run) {
  const out = {
    id: run.id,
    status: run.status,
    trigger: run.trigger,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    sizeBytes: run.sizeBytes != null ? Number(run.sizeBytes) : null,
    fileName: run.fileName,
    error: run.error,
    triggeredBy: run.triggeredBy ? { name: run.triggeredBy.name, email: run.triggeredBy.email } : null,
  };
  // For an in-progress run, report the current on-disk size so the UI can show
  // real forward progress (pg_dump grows the file as it writes).
  if (run.status === 'RUNNING' && run.fileName) {
    try { out.liveSizeBytes = fs.statSync(path.join(BACKUP_DIR, run.fileName)).size; } catch { out.liveSizeBytes = 0; }
  }
  return out;
}

export async function GET() {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  await reapStaleRuns();

  const runs = await prisma.backupRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: 50,
    include: { triggeredBy: { select: { name: true, email: true } } },
  });

  const lastSuccess = runs.find((r) => r.status === 'SUCCESS') ?? null;
  const active = runs.find((r) => r.status === 'RUNNING') ?? null;

  // Where backups are stored + how much room is left on that volume. Lets the
  // admin confirm at a glance whether backups live on the network share and
  // whether the app can actually write there.
  let storage = { dir: BACKUP_DIR, writable: false, totalBytes: null, freeBytes: null, isNetwork: /^\/mnt\/|^\/media\/|nfs|cifs/i.test(BACKUP_DIR) };
  try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch {}
  try { fs.accessSync(BACKUP_DIR, fs.constants.W_OK); storage.writable = true; } catch {}
  try {
    const s = fs.statfsSync(BACKUP_DIR);
    storage.totalBytes = s.blocks * s.bsize;
    storage.freeBytes  = s.bavail * s.bsize;
  } catch {}

  return NextResponse.json({
    runs: runs.map(serialize),
    lastSuccess: lastSuccess ? serialize(lastSuccess) : null,
    activeId: active?.id ?? null,
    storage,
    // 04:00 IST daily (server runs the cron at 22:30 UTC).
    schedule: 'Every day at 4:00 AM IST',
  });
}
