import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { getCloudflareContext } from '@opennextjs/cloudflare';

// Hyperdrive is a request-scoped binding, not a plain env var, and Prisma's
// own Workers guidance is to build a fresh client per request rather than
// reuse a module-level singleton the way `db.ts` does for the `node` target.
export async function getCloudflareDb(): Promise<PrismaClient> {
  const { env } = await getCloudflareContext({ async: true });
  const hyperdrive = (env as Record<string, unknown>).HYPERDRIVE as { connectionString: string } | undefined;
  if (!hyperdrive) {
    throw new Error('RUNTIME_TARGET=cloudflare but the HYPERDRIVE binding is missing');
  }
  const adapter = new PrismaPg({ connectionString: hyperdrive.connectionString });
  return new PrismaClient({ adapter });
}
