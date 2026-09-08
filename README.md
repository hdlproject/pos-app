This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Testing

Unit tests run against whatever `DATABASE_URL` currently resolves to (Vitest does not auto-load `.env`, so `DATABASE_URL` is otherwise undefined). Integration tests under `tests/integration/` hit a real Postgres database via `postgres` + Kysely, so they must be run against the **test** database (`pos_test`), not the dev database, to avoid clobbering dev data.

Point `DATABASE_URL` at the test database when running the test suite:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/pos_test npm test
```

The test database's schema must be migrated first (once, or after adding new migrations):

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/pos_test ./database/migrate.sh
```

The upload route and menu-image tests also need `JWT_SECRET` plus the four S3 env vars (matching `.env`) and a running MinIO, since they exercise the real S3 client wrapper. Start MinIO with `docker compose up -d minio` (or the full stack via `docker compose up -d`), then set the vars explicitly on the same command line as the test run:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/pos_test \
JWT_SECRET=dev-secret-change-in-prod \
S3_ENDPOINT=http://localhost:9000 \
S3_ACCESS_KEY=minioadmin \
S3_SECRET_KEY=minioadmin \
S3_BUCKET=menu-images \
npm test
```

To smoke-test the Cloudflare Workers bundle locally with `wrangler dev` against a real (local) Hyperdrive-emulated connection, `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` must be set on the actual process environment when `wrangler dev` runs — a value in `.dev.vars` alone is not read for this purpose:

```bash
npm run build:cf
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://postgres:postgres@localhost:5433/pos_dev npx wrangler dev
```

## Database migrations

Schema migrations are plain SQL files under `database/` (e.g. `database/001_initial.sql`), applied by `database/migrate.sh`. The script only shells out to `psql` — it has no Docker dependency — so it works identically against a local Postgres instance or a remote connection string (e.g. Neon):

```bash
DATABASE_URL="postgresql://..." ./database/migrate.sh
```

It tracks applied versions in a `schema_migrations` table and skips migrations already recorded there, so it's safe to re-run.

**Prerequisite:** `migrate.sh` requires a local `psql` client on `PATH`. It is *not* installed by this repo's Node dependencies, so a machine that has never needed a Postgres CLI before will hit `psql: command not found`.

- **macOS:**
  ```bash
  brew install libpq
  export PATH="$(brew --prefix libpq)/bin:$PATH"
  ```
  Add the `export` line to your shell profile (`~/.zshrc`, `~/.bash_profile`, etc.) so it persists across shells — `libpq` is keg-only and not linked onto `PATH` by default.
- **Linux CI:**
  ```bash
  apt-get install -y postgresql-client
  ```
  (or the equivalent package for the distro's package manager).

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
