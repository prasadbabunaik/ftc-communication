import path from 'path';
import os from 'os';

// Where dump files live — outside the repo, under the service account's home
// (override with BACKUP_DIR). The scheduler script uses the same default.
export const BACKUP_DIR = process.env.BACKUP_DIR || path.join(os.homedir(), 'ftc-backups');

// A run still marked RUNNING after this long is treated as orphaned (its process
// died / the server restarted mid-dump) and flipped to FAILED on the next read.
export const STALE_RUN_MS = 30 * 60 * 1000;

// How many dump files to keep on disk; older ones are pruned after each success.
export const RETENTION = Number(process.env.BACKUP_RETENTION || 14);

// The dump file basename for a given moment (safe, sortable).
export function backupFileName(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `ftc_communication_${stamp}.dump`;
}
