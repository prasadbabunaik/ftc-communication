import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import { requireServerUser, isAdmin } from '@/lib/server-auth';
import { prisma } from '@/lib/prisma';
import { backupFileName, STALE_RUN_MS } from '@/lib/backup';

export const dynamic = 'force-dynamic';

export async function POST() {
  let user;
  try { user = await requireServerUser(); }
  catch { return NextResponse.json({ error: 'Session expired.' }, { status: 401 }); }
  if (!isAdmin(user.role)) return NextResponse.json({ error: 'Administrator access required.' }, { status: 403 });

  // One backup at a time. A genuinely stuck run (older than the stale window) is
  // cleared so a manual trigger is never permanently blocked.
  const active = await prisma.backupRun.findFirst({ where: { status: 'RUNNING' } });
  if (active) {
    if (Date.now() - new Date(active.startedAt).getTime() < STALE_RUN_MS) {
      return NextResponse.json({ error: 'A backup is already in progress.', runId: active.id }, { status: 409 });
    }
    await prisma.backupRun.update({
      where: { id: active.id },
      data: { status: 'FAILED', finishedAt: new Date(), error: 'Superseded by a new backup.' },
    });
  }

  // Pre-create the row so the client gets an id to poll immediately; the child
  // process fills in the result. fileName is set now so GET can stat live size.
  const run = await prisma.backupRun.create({
    data: { status: 'RUNNING', trigger: 'MANUAL', triggeredById: user.id, fileName: backupFileName() },
  });

  // Detached so the dump outlives this request/response.
  const script = path.join(process.cwd(), 'scripts', 'backup-run.mjs');
  try {
    const child = spawn(process.execPath, [script, `--runId=${run.id}`], {
      cwd: process.cwd(),
      env: process.env,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch (e) {
    await prisma.backupRun.update({
      where: { id: run.id },
      data: { status: 'FAILED', finishedAt: new Date(), error: `Could not start backup: ${e.message}` },
    });
    return NextResponse.json({ error: 'Could not start the backup process.' }, { status: 500 });
  }

  return NextResponse.json({ runId: run.id });
}
