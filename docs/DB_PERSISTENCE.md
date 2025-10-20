# Prisma + Postgres persistence in Docker

- Postgres data persists in named volume `db_data` (default name `${DB_VOLUME_NAME:-jarvis_db_data}`).
- App waits for DB health and runs `prisma migrate deploy` on start. No `db push` or `migrate reset` in prod.

## Environment

```
DATABASE_URL="postgresql://jarvis:jarvis@db:5432/jarvis?schema=public"
NODE_ENV=production
SEED_ON_START=false
```

## Compose health and volumes

- DB healthcheck uses `pg_isready -U jarvis -d jarvis`.
- Backend depends on DB health: `depends_on: { db: { condition: service_healthy } }`.
- Persistent volume mounted at `/var/lib/postgresql/data`.

## Optional bind mount override

`docker-compose.persist.yml` lets you bind to a host directory via `DB_DATA_DIR`.

## Backup

Use the helper script which selects the right compose files automatically and writes a timestamped dump under `./backups`:

```
./scripts/backup-db.sh
```

Manual (equivalent):

```
docker compose exec -T db pg_dump -U jarvis -d jarvis > backups/$(date +%F_%H%M)-jarvis.sql
```

## Restore

```
cat backups/2025-09-21_1200-jarvis.sql | docker compose exec -T db psql -U jarvis -d jarvis
```

## Repair (ownership/privileges + migration recovery)

If migrations fail with errors like P3009/P3018 or "must be owner of table …", use the automated repair script:

```
./scripts/repair-db.sh
```

What it does:
- Fixes ownership of all public tables/sequences to the `jarvis` role (using the internal `postgres` role when needed)
- Grants proper privileges and default privileges
- Auto‑offers to create a quick backup before changes
- Detects previously failed migrations and safely marks them applied only when their changes are already present
- Baselines early migrations when the schema exists but `_prisma_migrations` history is missing
- Applies pending migrations (idempotent `CREATE IF NOT EXISTS` style where applicable)

Options:
- `PROJECT_NAME=techexplore` to target a specific compose project
- `DB_DATA_DIR=/opt/jarvis/db` to include `docker-compose.persist.yml`
- `CLOUDFLARE_TUNNEL_TOKEN=...` to include the tunnel compose

Post-check:

```
docker compose -p techexplore -f docker-compose.yml -f docker-compose.prod.yml logs --tail=120 backend
docker compose -p techexplore -f docker-compose.yml -f docker-compose.prod.yml exec -T backend sh -lc 'npx prisma migrate status'
```

## Safer update workflow (no data loss)

Follow this on every schema update:

1) Back up the DB

```
./scripts/backup-db.sh
```

2) Guard migrations locally (detect DROP COLUMN/TABLE etc.)

```
./scripts/guard-migrations.sh
```

CI: The repo includes a GitHub Actions workflow that runs the guard automatically on pushes/PRs to `main`. If you want the diff step to validate against a staging DB, add `DATABASE_URL` as a repository secret.

3) Update the deployment (rebuild + apply migrations)

```
./scripts/update.sh --pull
```

If startup fails with a Prisma error, run:

```
./scripts/repair-db.sh
```

If you must perform a destructive migration (drop/rename), plan a data‑migration:
- Add new columns/tables alongside old ones; write a backfill script.
- Deploy; backfill in code; shift reads/writes to new fields; only then drop old fields in a later release.

Backfill template:

```
# Copy and modify for your case
cp backend/scripts/backfill.template.ts backend/scripts/backfill-my-change.ts
npx tsx backend/scripts/backfill-my-change.ts
```

## Upgrading an existing DB volume (owner/role fix)

If your Postgres volume was created before adding the dedicated `jarvis` role, the `jarvis` database and tables may be owned by `postgres`. Prisma may then fail with:

- P1000: Authentication failed for `jarvis`
- permission denied for table `_prisma_migrations`

To fix once:

```
# Create role (idempotent; ignore error if it already exists)
docker compose exec -T db sh -lc "psql -U postgres -d postgres -c \"CREATE ROLE jarvis WITH LOGIN PASSWORD 'jarvis';\" || true"

# Transfer DB ownership and grant schema privileges
docker compose exec -T db sh -lc "psql -U postgres -d postgres -c \"ALTER DATABASE jarvis OWNER TO jarvis;\""
docker compose exec -T db sh -lc "psql -U postgres -d jarvis -c \"GRANT ALL PRIVILEGES ON SCHEMA public TO jarvis;\""

# Ensure Prisma can manage migrations table
docker compose exec -T db sh -lc "psql -U postgres -d jarvis -c \"ALTER TABLE IF EXISTS public._prisma_migrations OWNER TO jarvis;\" -c \"GRANT ALL PRIVILEGES ON TABLE public._prisma_migrations TO jarvis;\""

# Grant privileges on existing and future objects
docker compose exec -T db sh -lc "psql -U postgres -d jarvis -v ON_ERROR_STOP=1 -c \"GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO jarvis;\" -c \"GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO jarvis;\" -c \"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO jarvis;\" -c \"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO jarvis;\""

# If a migration previously failed but tables already exist, reconcile history
docker compose exec -T backend sh -lc "npx prisma migrate resolve --applied 20250918164512_add_studyset && npx prisma migrate deploy"

# Restart backend
docker compose restart backend
```

After this, the backend should start cleanly and log `Backend listening on :8080`.
