#!/usr/bin/env node
// Executes ONE database backup with pg_dump (custom/compressed format) and
// records it as a BackupRun row. Used two ways:
//   • cron (04:00 IST):  node scripts/backup-run.mjs --trigger=scheduled
//   • manual button:     the API pre-creates the row, then spawns this with
//                        --runId=<id> (so the request can return immediately
//                        and the browser can poll the row for live progress).
// Self-contained on purpose (no @/ alias imports) so it runs under plain node
// from cron as well as when spawned by the Next server.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

// Inherit env when spawned by the app; fall back to .env.local for cron. dotenv
// does not override already-set keys, so both paths get the right DATABASE_URL.
dotenv.config({ path: '.env.local' });

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(os.homedir(), 'ftc-backups');
const RETENTION = Number(process.env.BACKUP_RETENTION || 5); // dump files kept on disk
const ROW_RETENTION = 300; // history rows kept in the DB
const STALE_MS = 30 * 60 * 1000;

const argOf = (name, def = null) => {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split('=').slice(1).join('=') : def;
};
const runIdArg = argOf('runId');
const triggerArg = (argOf('trigger') || 'SCHEDULED').toUpperCase() === 'MANUAL' ? 'MANUAL' : 'SCHEDULED';

const pad = (n) => String(n).padStart(2, '0');
function fileNameFor(d = new Date()) {
  return `ftc_communication_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.dump`;
}

// Parse the connection URL tolerantly — the password may contain an unencoded
// '@'. Anchoring host:port/db at the end lets the greedy password span the '@'.
function parseDbUrl(url) {
  const m = url && url.match(/^postgres(?:ql)?:\/\/([^:@/]+):(.*)@([^@:/?]+):(\d+)\/([^?]+)/);
  if (!m) throw new Error('Could not parse DATABASE_URL');
  return { user: m[1], password: m[2], host: m[3], port: m[4], database: m[5].replace(/\/.*/, '') };
}

const prisma = new PrismaClient();

async function main() {
  const { user, password, host, port, database } = parseDbUrl(process.env.DATABASE_URL);

  let run;
  if (runIdArg) {
    run = await prisma.backupRun.findUnique({ where: { id: runIdArg } });
    if (!run) { console.error('backup run not found:', runIdArg); process.exit(1); }
  } else {
    // Don't stack scheduled runs on top of an active one.
    const active = await prisma.backupRun.findFirst({ where: { status: 'RUNNING' } });
    if (active && Date.now() - new Date(active.startedAt).getTime() < STALE_MS) {
      console.log('a backup is already running; skipping');
      await prisma.$disconnect();
      return;
    }
    run = await prisma.backupRun.create({ data: { status: 'RUNNING', trigger: triggerArg, fileName: fileNameFor() } });
  }

  const fileName = run.fileName || fileNameFor();
  const filePath = path.join(BACKUP_DIR, fileName);
  if (!run.fileName) await prisma.backupRun.update({ where: { id: run.id }, data: { fileName } });

  // Ensure the backup directory exists and is writable BEFORE pg_dump. On a
  // network mount (NFS/CIFS) this catches an unmounted / read-only / wrong-perms
  // target and records a clear FAILED entry instead of crashing silently.
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    fs.accessSync(BACKUP_DIR, fs.constants.W_OK);
  } catch (e) {
    await prisma.backupRun.update({
      where: { id: run.id },
      data: { status: 'FAILED', finishedAt: new Date(), durationMs: 0, error: `Backup directory not writable: ${BACKUP_DIR} — ${e.message}` },
    });
    console.error('backup directory not writable:', BACKUP_DIR, e.message);
    await prisma.$disconnect();
    return;
  }

  const startedAt = Date.now();
  const result = await new Promise((resolve) => {
    const child = spawn('pg_dump', [
      '-h', host, '-p', String(port), '-U', user, '-d', database,
      '-Fc', '--no-owner', '--no-privileges', '-f', filePath,
    ], { env: { ...process.env, PGPASSWORD: password } });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => resolve({ ok: false, err: e.message }));
    child.on('close', (code) => resolve(code === 0 ? { ok: true } : { ok: false, err: (stderr.trim() || `pg_dump exited with code ${code}`).slice(0, 1500) }));
  });

  const durationMs = Date.now() - startedAt;

  if (result.ok) {
    let size = 0;
    try { size = fs.statSync(filePath).size; } catch {}
    await prisma.backupRun.update({
      where: { id: run.id },
      data: { status: 'SUCCESS', finishedAt: new Date(), durationMs, sizeBytes: BigInt(size), error: null },
    });
    console.log(`backup succeeded: ${fileName} (${size} bytes, ${durationMs} ms)`);

    // Prune old dump files (keep newest RETENTION).
    try {
      const files = fs.readdirSync(BACKUP_DIR)
        .filter((f) => f.endsWith('.dump'))
        .map((f) => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
      for (const { f } of files.slice(RETENTION)) fs.unlinkSync(path.join(BACKUP_DIR, f));
    } catch (e) { console.error('rotation error:', e.message); }

    // Prune old history rows.
    try {
      const stale = await prisma.backupRun.findMany({ orderBy: { startedAt: 'desc' }, skip: ROW_RETENTION, select: { id: true } });
      if (stale.length) await prisma.backupRun.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });
    } catch {}
  } else {
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
    await prisma.backupRun.update({
      where: { id: run.id },
      data: { status: 'FAILED', finishedAt: new Date(), durationMs, error: result.err || 'Unknown error' },
    });
    console.error('backup failed:', result.err);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
