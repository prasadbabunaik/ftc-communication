# Deployment

## Environment Variables

The application reads its configuration from `.env`. Use [`.env.example`](../.env.example) as a template.

| Variable                   | Required | Description                                           |
|----------------------------|----------|-------------------------------------------------------|
| `DATABASE_URL`             | yes      | Postgres URL — `postgresql://user:pass@host:5432/db`  |
| `JWT_ACCESS_SECRET`        | yes      | ≥ 32 chars — signs short-lived access tokens          |
| `JWT_REFRESH_SECRET`       | yes      | ≥ 32 chars — signs refresh tokens                     |
| `JWT_ACCESS_EXPIRES_IN`    | no       | Default `15m`                                         |
| `JWT_REFRESH_EXPIRES_IN`   | no       | Default `7d`                                          |
| `NEXT_PUBLIC_APP_URL`      | yes      | Public origin — used for CORS, cookies, emails        |

**Generating secrets** (Linux/macOS):
```bash
openssl rand -base64 48
```

**Cookie domain** — access/refresh tokens are HttpOnly cookies scoped to `NEXT_PUBLIC_APP_URL`. Set this to the canonical https origin in production.

## Prerequisites

- Node.js 20 LTS or newer
- PostgreSQL 14 or newer
- 512 MB RAM minimum, 1 GB recommended
- Outbound HTTPS for external CDN assets (Tailwind / fonts at build time)

## Production Build

```bash
# 1. Install production deps
npm ci

# 2. Apply migrations (idempotent)
npx prisma migrate deploy

# 3. Build
npm run build

# 4. Start (defaults to PORT=3000)
PORT=8080 npm run start
```

## Database

### Initial setup

```bash
# Connect as a privileged user and create role + db
createuser --pwprompt ftc_app
createdb --owner=ftc_app ftc_communication
```

Set `DATABASE_URL` accordingly:
```
postgresql://ftc_app:<password>@db.internal:5432/ftc_communication
```

### Migrations

The deploy pipeline must run `prisma migrate deploy` before starting the app. This applies any new migrations in `prisma/migrations/` without prompting.

For schema changes during development:
```bash
npx prisma migrate dev --name describe_what_changed
```

### Seeding

```bash
npm run db:seed                # users, regions, plant types, sample SR projects
```

The seed is **idempotent** for master data (uses `upsert`), but creating sample projects checks for existence before inserting. Re-running on a populated DB is safe.

For full project data, run the snapshot seeder after the main seed:
```bash
node scripts/seed-snapshots-db.js
node scripts/backfill-hybrid-components.js
```

### Backups

Daily Postgres dumps recommended:
```bash
pg_dump --format=custom --compress=9 \
  --no-owner --no-privileges \
  --file="ftc-$(date +%Y-%m-%d).backup" \
  "$DATABASE_URL"
```

Retain at least 30 days of snapshots; the audit feed is the audit-of-record but loses context if rows are deleted.

## Hosting Options

### Self-hosted (recommended for sensitive data)

The app is a standard Next.js server. Any container runtime works:

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json prisma ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package*.json ./
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
EXPOSE 3000
CMD ["sh","-c","npx prisma migrate deploy && npm run start"]
```

Run behind a TLS-terminating reverse proxy (nginx, Caddy, or a managed load balancer).

### Vercel / Netlify

Works out of the box, but the audit-feed write pattern (`createMany` after diff) needs a Postgres provider that supports a high connection count or a connection pooler (PgBouncer, Supabase pooler, Neon).

## Reverse Proxy Notes

Example nginx fragment:

```nginx
server {
    listen 443 ssl http2;
    server_name ftc.example.gov.in;

    ssl_certificate     /etc/letsencrypt/live/ftc.example.gov.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ftc.example.gov.in/privkey.pem;

    # Forward real client IP and protocol (required for secure cookies)
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    client_max_body_size 25M;          # for Excel uploads

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_buffering off;           # SSR streaming
    }
}
```

## Resource Sizing

The dashboard fetches all in-scope projects on each load and computes tables in memory. For 1,000–2,000 projects with full phase history:

- DB query: < 200 ms
- Compute pass: < 50 ms
- Total page TTFB: ~ 250 ms

Memory profile is flat — no large per-request buffers. A 1-vCPU / 1-GB instance comfortably serves dozens of concurrent users.

## Monitoring

Recommended:
- HTTP-level metrics from the reverse proxy (rate, p95 latency, 5xx ratio)
- Postgres slow-query log (threshold ≥ 200 ms)
- Disk usage on Postgres volume (the `grid_snapshots` JSON blobs and `project_notes` grow steadily)

## Security Posture

- Every server action verifies a JWT cookie via `requireServerUser()`.
- Region scope is re-checked **after** loading the target record (never trust client-supplied IDs alone).
- Zod schemas validate both client-side and inside server actions.
- Passwords are bcrypt-hashed (`cost = 12`).
- Refresh tokens are rotated on every refresh; old tokens are invalidated.
- Cookies are `HttpOnly`, `SameSite=Lax`, `Secure` in production.

## Upgrade Path

1. Pull the new code.
2. Install: `npm ci`.
3. Apply new migrations: `npx prisma migrate deploy`.
4. Rebuild: `npm run build`.
5. Restart the Node process.

Migrations are append-only — a rollback requires a custom down migration plus DB restore from backup. Always snapshot the DB before upgrading.
