#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set explicitly, e.g. DATABASE_URL=postgresql://... ./database/migrate.sh}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bootstrap: if the schema already exists (applied previously via Prisma
-- migrate before this repo switched to raw SQL), record 001_initial as
-- already applied WITHOUT running its CREATE TABLE statements against data
-- that already exists. A freshly created database (a wiped pos_test) has no
-- "User" table yet, so this is a no-op there and 001_initial.sql runs for
-- real in the loop below.
INSERT INTO public.schema_migrations (version)
SELECT '001_initial'
WHERE to_regclass('public."User"') IS NOT NULL
ON CONFLICT DO NOTHING;
SQL

for file in "$SCRIPT_DIR"/[0-9][0-9][0-9]_*.sql; do
  version="$(basename "$file" .sql)"
  already_applied="$(psql "$DATABASE_URL" -tAc "SELECT 1 FROM public.schema_migrations WHERE version = '$version'")"
  if [ "$already_applied" = "1" ]; then
    echo "skip $version (already applied)"
    continue
  fi
  echo "applying $version"
  # NOTE: schema_migrations is schema-qualified here (public.schema_migrations)
  # because pg_dump output (001_initial.sql and any future dump-derived
  # migration) sets search_path to '' via
  # `SELECT pg_catalog.set_config('search_path', '', false);` — that `false`
  # means it is NOT transaction-local, so it persists for the rest of this
  # psql invocation's connection, and an unqualified name in the trailing -c
  # below would fail to resolve after -f runs.
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
    -f "$file" \
    -c "INSERT INTO public.schema_migrations (version) VALUES ('$version')"
done
