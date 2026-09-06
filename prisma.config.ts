import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // `prisma generate` never opens a connection, but config loading still
    // eagerly resolves this -- Cloudflare's build step has no DATABASE_URL
    // (that's the deployed Worker's runtime config, via Hyperdrive), so a
    // strict env() lookup here would fail generate for no real reason. Real
    // DB commands (migrate/studio) and the app itself still read the real
    // DATABASE_URL wherever it's actually set.
    url: process.env.DATABASE_URL ?? 'postgresql://placeholder:placeholder@localhost:5432/placeholder',
  },
  migrations: {
    seed: 'npx tsx prisma/seed.ts',
  },
});
