#!/usr/bin/env bash
# Cron entry point for the daily database backup (04:00 IST = 22:30 UTC).
# Runs the same executor the manual button uses, with a plain-node environment.
set -euo pipefail

# nvm's node isn't on cron's PATH by default; add it (and the pg_dump location).
export PATH="/home/prasad-173/.nvm/versions/node/v24.15.0/bin:/usr/bin:/bin:$PATH"

# Repo root = one level up from this script, so this works wherever it's deployed.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

mkdir -p "$HOME/ftc-backups"
echo "[$(date -u +%FT%TZ)] starting scheduled backup from $DIR" >> "$HOME/ftc-backups/backup-cron.log"
node scripts/backup-run.mjs --trigger=scheduled >> "$HOME/ftc-backups/backup-cron.log" 2>&1
