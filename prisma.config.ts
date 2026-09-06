import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const runtimeTarget = process.env.RUNTIME_TARGET ?? 'node';

function resolveDatabaseUrl(): string {
  if (runtimeTarget === 'cloudflare') {
    // Real DB access on Cloudflare goes through the Hyperdrive binding at
    // Worker request time (src/server/db.cloudflare.ts) -- this CLI config
    // has no access to that binding outside a deployed Worker, and `prisma
    // generate`'s config loading still needs *some* syntactically valid
    // value. Never used for a real connection in this runtime target.
    return 'postgresql://placeholder:placeholder@localhost:5432/placeholder';
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required when RUNTIME_TARGET is unset or "node" (see prisma.config.ts).');
  }
  return process.env.DATABASE_URL;
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: resolveDatabaseUrl(),
  },
  migrations: {
    seed: 'npx tsx prisma/seed.ts',
  },
});
