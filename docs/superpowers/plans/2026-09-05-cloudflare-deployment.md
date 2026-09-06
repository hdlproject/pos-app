# Cloudflare Deployment (v4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support two deploy targets — the existing Node server (unchanged) and a new Cloudflare Workers target via the OpenNext adapter — selected by a `RUNTIME_TARGET` env var, with zero behavior change to the Node path.

**Architecture:** Only two things need runtime branching, because Cloudflare Hyperdrive and KV are request-scoped bindings rather than plain env vars: Postgres client construction and the AI-suggestion cooldown store. Everything else (R2 storage, Ably, JWT) is already env-var-only and needs no code change. `bcrypt` (a native addon that cannot run on Workers under any compatibility flag) is replaced everywhere with Web Crypto PBKDF2, collapsing what could have been a third branch into a single code path.

**Tech Stack:** Next.js 16 App Router, tRPC v11, Prisma 7.9.1 + `@prisma/adapter-pg`, `@opennextjs/cloudflare`, Cloudflare Hyperdrive + KV.

## Global Constraints

- `RUNTIME_TARGET` env var: unset or `node` = today's behavior (default); `cloudflare` = new Workers path. Read via `process.env.RUNTIME_TARGET`.
- PBKDF2 hash format (exact, from spec): `pbkdf2$<iterations>$<base64 salt>$<base64 hash>`.
- Cloudflare bindings are named exactly `HYPERDRIVE` (Hyperdrive) and `COOLDOWN_KV` (KV namespace).
- `wrangler.jsonc` must set `compatibility_flags: ["nodejs_compat"]` and `compatibility_date` >= `2024-09-23`.
- If `RUNTIME_TARGET=cloudflare` and a required binding is missing at request time, throw immediately with a message naming the missing binding — never silently fall back to a Node-style client.
- DB safety rule: every DB-touching command sets `DATABASE_URL` explicitly on that command line, never via `source .env`. Test env line: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" npm test`.
- No git worktree — work directly on `master` (no remote configured), matching every prior feature this session.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- No CI/CD auto-deploy pipeline, no changes to Ably/JWT/tRPC business logic, no automated Workers-runtime test in CI — all explicitly out of scope per the spec.

---

### Task 1: Replace bcrypt with Web Crypto PBKDF2 for PIN hashing

**Files:**
- Modify: `src/server/auth/pin.ts`
- Modify: `prisma/seed.ts`
- Modify: `package.json` (remove `bcrypt`, `@types/bcrypt`)
- Test: `tests/unit/auth.test.ts` (existing "pin hashing" block, extend with a format assertion)

**Interfaces:**
- Produces: `hashPin(pin: string): Promise<string>` and `verifyPin(pin: string, stored: string): Promise<boolean>` — same signatures as today, callers elsewhere (`src/server/trpc/routers/auth.ts`, every integration test that creates a user with `pinHash: await hashPin(...)`) need zero changes.

Current `src/server/auth/pin.ts`:
```ts
import bcrypt from 'bcrypt';

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}
```

- [ ] **Step 1: Confirm the existing round-trip test currently passes (bcrypt baseline)**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" npx vitest run tests/unit/auth.test.ts -t "pin hashing"`

Expected: PASS (this is the baseline before the swap — the test itself doesn't assert on hash format, so it will still pass after the swap without modification, but running it now confirms today's state).

- [ ] **Step 2: Add a format-lock-in assertion to the existing test**

In `tests/unit/auth.test.ts`, extend the `'pin hashing'` describe block:

```ts
describe('pin hashing', () => {
  it('verifies a correct PIN and rejects a wrong one', async () => {
    const hash = await hashPin('1234');
    expect(await verifyPin('1234', hash)).toBe(true);
    expect(await verifyPin('9999', hash)).toBe(false);
  });

  it('produces a pbkdf2-formatted hash, not a bcrypt one', async () => {
    const hash = await hashPin('1234');
    expect(hash).toMatch(/^pbkdf2\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  });

  it('rejects a malformed or foreign hash instead of throwing', async () => {
    await expect(verifyPin('1234', 'not-a-real-hash')).resolves.toBe(false);
    await expect(verifyPin('1234', '$2b$10$notarealbcryptash')).resolves.toBe(false);
  });
});
```

- [ ] **Step 3: Run the extended test to verify it fails (new assertions, old implementation)**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" npx vitest run tests/unit/auth.test.ts -t "pin hashing"`

Expected: FAIL on `'produces a pbkdf2-formatted hash, not a bcrypt one'` — bcrypt hashes look like `$2b$10$...`, not `pbkdf2$...`.

- [ ] **Step 4: Replace `src/server/auth/pin.ts`'s implementation**

```ts
const ITERATIONS = 100_000;
const HASH_ALGORITHM = 'SHA-256';
const KEY_LENGTH_BYTES = 32;
const SALT_LENGTH_BYTES = 16;

export async function hashPin(pin: string): Promise<string> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
  const derived = await deriveBits(pin, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toBase64(salt)}$${toBase64(derived)}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;

  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;

  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromBase64(parts[2]);
    expected = fromBase64(parts[3]);
  } catch {
    return false;
  }

  const actual = await deriveBits(pin, salt, iterations);
  return timingSafeEqual(actual, expected);
}

async function deriveBits(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: HASH_ALGORITHM },
    keyMaterial,
    KEY_LENGTH_BYTES * 8
  );
  return new Uint8Array(bits);
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function fromBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
```

This uses only `globalThis.crypto` (Web Crypto API) and `Buffer` (already used elsewhere in this codebase, e.g. `src/app/api/upload/route.ts`), both available natively in Node >=15 and in Cloudflare Workers with `nodejs_compat` — no new npm dependency, one code path for both runtimes.

- [ ] **Step 5: Run the test again to verify it passes**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" npx vitest run tests/unit/auth.test.ts -t "pin hashing"`

Expected: PASS (all three cases).

- [ ] **Step 6: Update `prisma/seed.ts` to use `hashPin` instead of calling `bcrypt` directly**

Current relevant lines in `prisma/seed.ts`:
```ts
import bcrypt from 'bcrypt';
// ...
{ name: 'Admin', role: 'ADMIN', pinHash: await bcrypt.hash('1234', 10) },
{ name: 'Staff', role: 'STAFF', pinHash: await bcrypt.hash('2345', 10) },
{ name: 'Kitchen', role: 'KITCHEN', pinHash: await bcrypt.hash('4567', 10) },
```

Change to:
```ts
import { hashPin } from '../src/server/auth/pin';
// ...
{ name: 'Admin', role: 'ADMIN', pinHash: await hashPin('1234') },
{ name: 'Staff', role: 'STAFF', pinHash: await hashPin('2345') },
{ name: 'Kitchen', role: 'KITCHEN', pinHash: await hashPin('4567') },
```

Remove the `import bcrypt from 'bcrypt';` line entirely. Same demo PIN values (`1234`/`2345`/`4567`) — this is a straight format swap, not a value change, per the user's explicit decision that there's no real user data to preserve.

- [ ] **Step 7: Remove `bcrypt` and `@types/bcrypt` from `package.json`**

Run: `npm uninstall bcrypt @types/bcrypt`

- [ ] **Step 8: Full build and test check**

Run: `npm run build`
Expected: clean, no TypeScript errors, no remaining `bcrypt` import anywhere (grep to confirm: `grep -rn "bcrypt" src prisma` should return nothing).

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" npm test`
Expected: all tests pass, including every integration test that creates a user via `hashPin(...)` (auth-router, order-router, payment-router, stock-batch-router, ingredient-router, upload-route) — none of these need code changes, they only call `hashPin` as an opaque helper.

- [ ] **Step 9: Re-seed pos_dev with the new hash format**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_dev" npx tsx prisma/seed.ts`

This overwrites the demo users' `pinHash` in `pos_dev` (same PIN values, new format) — per the user's explicit decision, this is expected and fine since there's no real production data in `pos_dev` today, only demo/dev users.

- [ ] **Step 10: Commit**

```bash
git add src/server/auth/pin.ts prisma/seed.ts package.json package-lock.json tests/unit/auth.test.ts
git commit -m "$(cat <<'EOF'
Replace bcrypt with Web Crypto PBKDF2 for PIN hashing

bcrypt is a native addon and cannot run on Cloudflare Workers under
any compatibility flag -- this blocks the planned Workers deploy
target entirely. Web Crypto's PBKDF2 (globalThis.crypto.subtle) is
built into both Node and Workers natively, so this removes the
dependency and collapses what would have been a runtime branch into
one code path for both targets.

No real user data exists yet (dev/demo PINs only), so this is a
straight format swap with no dual-verify migration path -- seed.ts
reseeds the same demo PIN values in the new format.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Runtime-aware request context (Postgres client + cooldown store)

**Files:**
- Create: `src/server/db.cloudflare.ts`
- Create: `src/server/cooldownStore.ts`
- Delete: `src/server/ai/cooldown.ts`
- Delete: `tests/unit/ai-cooldown.test.ts`
- Create: `tests/unit/cooldownStore.test.ts`
- Modify: `src/server/trpc/context.ts`
- Modify: `src/server/trpc/routers/aiSuggestion.ts`
- Modify: `tests/integration/ai-suggestion-router.test.ts`
- Modify: `.env.example` (document `RUNTIME_TARGET`)

**Interfaces:**
- Consumes: `db` (the existing Node singleton) from `src/server/db.ts` — read-only, unchanged, still exported exactly as today: `export const db: PrismaClient`.
- Produces:
  - `CooldownStore` type: `{ checkAndSet(key: string, ttlSeconds: number): Promise<boolean>; clear(key: string): Promise<void> }` — `checkAndSet` returns `true` if the key was NOT already on cooldown (and is now set), `false` if it was already on cooldown.
  - `RedisCooldownStore` and `KvCooldownStore` classes implementing `CooldownStore`, both exported from `src/server/cooldownStore.ts`.
  - `KvNamespaceLike` type (minimal shape for a Cloudflare KV binding), exported from `src/server/cooldownStore.ts`.
  - `getCloudflareDb(): Promise<PrismaClient>`, exported from `src/server/db.cloudflare.ts`.
  - `Context` type (explicit, not purely inferred): `{ db: PrismaClient; user: { userId: string; role: Role; name: string } | null; cooldownStore?: CooldownStore }` — `cooldownStore` is optional on the *type* (even though `createContext()` always populates it at runtime) so that the ~50 existing test call sites doing `appRouter.createCaller({ db, user })` keep compiling without passing a cooldown store they never exercise. Only `tests/integration/ai-suggestion-router.test.ts` (the one test file that actually exercises cooldown behavior) needs to pass one in.

Read `src/server/redis.ts`, `src/server/ai/cooldown.ts`, `src/server/trpc/context.ts`, `src/server/trpc/routers/aiSuggestion.ts`, and `src/server/trpc/trpc.ts` in full before starting — this task's design depends on their exact current contents (verified already; reproduced below where needed).

- [ ] **Step 1: Write the failing unit tests for the new cooldown store abstraction**

Delete `tests/unit/ai-cooldown.test.ts` (its coverage is superseded by the file below — it tested the old module-level `checkAndSetCooldown`/`clearCooldown` functions which no longer exist after this task).

Create `tests/unit/cooldownStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { redis } from '@/server/redis';
import { RedisCooldownStore, KvCooldownStore, type KvNamespaceLike } from '@/server/cooldownStore';

describe('RedisCooldownStore', () => {
  const store = new RedisCooldownStore();

  beforeEach(async () => {
    await redis.flushdb();
  });

  it('allows the first request for a key', async () => {
    await expect(store.checkAndSet('table-a', 30)).resolves.toBe(true);
  });

  it('blocks a second request for the same key within the ttl', async () => {
    await store.checkAndSet('table-a', 30);
    await expect(store.checkAndSet('table-a', 30)).resolves.toBe(false);
  });

  it('tracks cooldowns independently per key', async () => {
    await store.checkAndSet('table-a', 30);
    await expect(store.checkAndSet('table-b', 30)).resolves.toBe(true);
  });

  it('releases the cooldown so a subsequent request is allowed again', async () => {
    await store.checkAndSet('table-x', 30);
    await store.clear('table-x');
    await expect(store.checkAndSet('table-x', 30)).resolves.toBe(true);
  });
});

function fakeKv(): KvNamespaceLike {
  const data = new Map<string, string>();
  return {
    get: async (key) => data.get(key) ?? null,
    put: async (key, value) => {
      data.set(key, value);
    },
    delete: async (key) => {
      data.delete(key);
    },
  };
}

describe('KvCooldownStore', () => {
  it('allows the first request for a key', async () => {
    const store = new KvCooldownStore(fakeKv());
    await expect(store.checkAndSet('table-a', 30)).resolves.toBe(true);
  });

  it('blocks a second request for the same key', async () => {
    const store = new KvCooldownStore(fakeKv());
    await store.checkAndSet('table-a', 30);
    await expect(store.checkAndSet('table-a', 30)).resolves.toBe(false);
  });

  it('tracks cooldowns independently per key', async () => {
    const store = new KvCooldownStore(fakeKv());
    await store.checkAndSet('table-a', 30);
    await expect(store.checkAndSet('table-b', 30)).resolves.toBe(true);
  });

  it('releases the cooldown so a subsequent request is allowed again', async () => {
    const store = new KvCooldownStore(fakeKv());
    await store.checkAndSet('table-x', 30);
    await store.clear('table-x');
    await expect(store.checkAndSet('table-x', 30)).resolves.toBe(true);
  });
});
```

- [ ] **Step 2: Run the new test file to verify it fails**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" npx vitest run tests/unit/cooldownStore.test.ts`

Expected: FAIL with a module-not-found error for `@/server/cooldownStore` (it doesn't exist yet).

- [ ] **Step 3: Create `src/server/cooldownStore.ts`**

```ts
import { redis } from './redis';

export type CooldownStore = {
  checkAndSet(key: string, ttlSeconds: number): Promise<boolean>;
  clear(key: string): Promise<void>;
};

// Wraps the same ioredis SET-NX-EX logic the old ai/cooldown.ts used --
// atomic on Redis, used for the `node` runtime target.
export class RedisCooldownStore implements CooldownStore {
  async checkAndSet(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await redis.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async clear(key: string): Promise<void> {
    await redis.del(key);
  }
}

// Minimal shape of a Cloudflare KV namespace binding -- avoids pulling in
// @cloudflare/workers-types just for this one interface.
export type KvNamespaceLike = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
};

// get-then-put is not atomic the way Redis's SET NX is -- KV's eventual
// consistency means a narrow race window under concurrent requests for the
// exact same key. Acceptable here: this only needs to deter rapid re-requests
// from the same table, not guarantee strict exactly-once semantics.
export class KvCooldownStore implements CooldownStore {
  constructor(private kv: KvNamespaceLike) {}

  async checkAndSet(key: string, ttlSeconds: number): Promise<boolean> {
    const existing = await this.kv.get(key);
    if (existing !== null) return false;
    await this.kv.put(key, '1', { expirationTtl: ttlSeconds });
    return true;
  }

  async clear(key: string): Promise<void> {
    await this.kv.delete(key);
  }
}
```

- [ ] **Step 4: Run the test file again to verify it passes**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" npx vitest run tests/unit/cooldownStore.test.ts`

Expected: PASS (all 8 cases).

- [ ] **Step 5: Delete the old cooldown module**

Delete `src/server/ai/cooldown.ts` (its logic now lives in `RedisCooldownStore` above; it has no other consumers besides `aiSuggestion.ts`, updated next).

- [ ] **Step 6: Create `src/server/db.cloudflare.ts`**

```ts
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
```

Note: this file imports `@opennextjs/cloudflare`, which Task 3 adds as a dependency. If Task 3 hasn't run yet when this task executes, run `npm install -D @opennextjs/cloudflare` first so this file type-checks — either order works since the two tasks don't otherwise depend on each other, but the import must resolve before `npm run build` in Step 9 below will pass.

- [ ] **Step 7: Rewrite `src/server/trpc/context.ts`**

Current file:
```ts
import { cookies } from 'next/headers';
import { db } from '../db';
import { verifySession } from '../auth/session';

export async function createContext() {
  const token = (await cookies()).get('session')?.value;
  const payload = token ? await verifySession(token) : null;

  let user = null;
  if (payload) {
    const dbUser = await db.user.findUnique({ where: { id: payload.userId } });
    if (dbUser && dbUser.active) {
      user = { userId: dbUser.id, role: dbUser.role, name: dbUser.name };
    }
  }

  return { db, user };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
```

Replace with:
```ts
import { cookies } from 'next/headers';
import type { PrismaClient, Role } from '@prisma/client';
import { db as nodeDb } from '../db';
import { verifySession } from '../auth/session';
import { getCloudflareDb } from '../db.cloudflare';
import { RedisCooldownStore, KvCooldownStore, type CooldownStore, type KvNamespaceLike } from '../cooldownStore';

export type Context = {
  db: PrismaClient;
  user: { userId: string; role: Role; name: string } | null;
  // Optional on the type (even though createContext() always sets it) so
  // the ~50 existing test call sites that do
  // `appRouter.createCaller({ db, user })` keep compiling without needing
  // to plumb a cooldown store through routers that never touch it.
  cooldownStore?: CooldownStore;
};

async function getContextDb(): Promise<PrismaClient> {
  if (process.env.RUNTIME_TARGET === 'cloudflare') {
    return getCloudflareDb();
  }
  return nodeDb;
}

async function getContextCooldownStore(): Promise<CooldownStore> {
  if (process.env.RUNTIME_TARGET === 'cloudflare') {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const { env } = await getCloudflareContext({ async: true });
    const kv = (env as Record<string, unknown>).COOLDOWN_KV as KvNamespaceLike | undefined;
    if (!kv) {
      throw new Error('RUNTIME_TARGET=cloudflare but the COOLDOWN_KV binding is missing');
    }
    return new KvCooldownStore(kv);
  }
  return new RedisCooldownStore();
}

export async function createContext(): Promise<Context> {
  const db = await getContextDb();
  const cooldownStore = await getContextCooldownStore();

  const token = (await cookies()).get('session')?.value;
  const payload = token ? await verifySession(token) : null;

  let user: Context['user'] = null;
  if (payload) {
    const dbUser = await db.user.findUnique({ where: { id: payload.userId } });
    if (dbUser && dbUser.active) {
      user = { userId: dbUser.id, role: dbUser.role, name: dbUser.name };
    }
  }

  return { db, user, cooldownStore };
}
```

- [ ] **Step 8: Update `src/server/trpc/routers/aiSuggestion.ts` to use `ctx.cooldownStore`**

Current relevant lines:
```ts
import { checkAndSetCooldown, clearCooldown } from '../../ai/cooldown';
// ...
export const aiSuggestionRouter = router({
  getSuggestion: publicProcedure.input(suggestionInput).mutation(async ({ ctx, input }) => {
    const table = await ctx.db.table.findUnique({ where: { qrToken: input.tableToken } });
    if (!table) throw new TRPCError({ code: 'NOT_FOUND', message: 'invalid table token' });

    const allowed = await checkAndSetCooldown(input.tableToken);
    if (!allowed) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: 'Please wait a moment before requesting more suggestions.',
      });
    }
    // ...
        await clearCooldown(input.tableToken);
        return { results: input.requests.map((r) => ({ type: r.type, suggestions: [] as SuggestionCard[] })) };
    // ...
      await clearCooldown(input.tableToken);
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: "Couldn't get suggestions, try again." });
```

Replace the whole file with (only the import line, the new `COOLDOWN_SECONDS`/`cooldownKey` declarations, and the cooldown-related lines inside `getSuggestion` differ from today's file — everything else, including `SuggestionMenuRow`/`SuggestionCard`/`requestInput`/`suggestionInput`, is byte-for-byte identical to what's there today):

```ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { TASTE_OPTIONS, AROMA_OPTIONS, TEXTURE_OPTIONS } from '../../../lib/suggestionOptions';
import { buildSuggestionMessages, parseSuggestionResponse, SuggestionParseError } from '../../ai/suggestion';
import { fetchChatCompletion } from '../../ai/openaiClient';

const requestInput = z.object({
  type: z.string().min(1).max(60),
  taste: z.array(z.enum(TASTE_OPTIONS)).max(TASTE_OPTIONS.length),
  aroma: z.array(z.enum(AROMA_OPTIONS)).max(AROMA_OPTIONS.length),
  texture: z.array(z.enum(TEXTURE_OPTIONS)).max(TEXTURE_OPTIONS.length),
  notes: z.string().max(200).optional(),
});

// One or more per-type requests, submitted together as a single bulk call --
// all of them share one cooldown check rather than each burning its own,
// which is what firing N separate publicProcedure calls concurrently for
// the same tableToken would otherwise race against (the cooldown key is
// per table, not per type).
const suggestionInput = z.object({
  tableToken: z.string(),
  requests: z.array(requestInput).min(1).max(10),
});

const COOLDOWN_SECONDS = 30;

function cooldownKey(tableToken: string): string {
  return `ai-suggest-cooldown:${tableToken}`;
}

// Explicit flat row shape -- same TS2589 workaround as every other router
// here (see menu.ts's MenuItemWithCategory) for a Prisma query with a
// nested include.
type SuggestionMenuRow = {
  id: string;
  name: string;
  price: unknown;
  image: string | null;
  category: { name: string };
};

type SuggestionCard = {
  menuItemId: string;
  name: string;
  price: string;
  image: string | null;
  categoryName: string;
  reason: string;
};

export const aiSuggestionRouter = router({
  getSuggestion: publicProcedure.input(suggestionInput).mutation(async ({ ctx, input }) => {
    const cooldownStore = ctx.cooldownStore;
    if (!cooldownStore) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'cooldown store not configured' });
    }

    const table = await ctx.db.table.findUnique({ where: { qrToken: input.tableToken } });
    if (!table) throw new TRPCError({ code: 'NOT_FOUND', message: 'invalid table token' });

    const allowed = await cooldownStore.checkAndSet(cooldownKey(input.tableToken), COOLDOWN_SECONDS);
    if (!allowed) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: 'Please wait a moment before requesting more suggestions.',
      });
    }

    const items = (await ctx.db.menuItem.findMany({
      where: { available: true, outOfStockReason: null },
      include: { category: true },
    })) as unknown as SuggestionMenuRow[];

    if (items.length === 0) {
      await cooldownStore.clear(cooldownKey(input.tableToken));
      return { results: input.requests.map((r) => ({ type: r.type, suggestions: [] as SuggestionCard[] })) };
    }

    const menuForAi = items.map((i) => ({ id: i.id, name: i.name, category: i.category.name, price: Number(i.price) }));
    const byId = new Map(items.map((i) => [i.id, i]));

    try {
      // Every sub-request goes out at once (Promise.all), not one after
      // another -- "sent to AI at the same time" -- and any single failure
      // (network, malformed response) fails the whole batch the same way a
      // single-request failure always has, rather than returning partial
      // results the customer would have to sort out which page succeeded.
      const results = await Promise.all(
        input.requests.map(async (r) => {
          const messages = buildSuggestionMessages(
            { taste: r.taste, aroma: r.aroma, texture: r.texture, type: [r.type], notes: r.notes },
            menuForAi
          );
          const raw = await fetchChatCompletion(messages);
          const parsed = parseSuggestionResponse(raw, menuForAi);
          const suggestions = parsed
            .map((p): SuggestionCard | null => {
              const item = byId.get(p.menuItemId);
              if (!item) return null;
              return {
                menuItemId: item.id,
                name: item.name,
                price: String(item.price),
                image: item.image,
                categoryName: item.category.name,
                reason: p.reason,
              };
            })
            .filter((s): s is SuggestionCard => s !== null);
          return { type: r.type, suggestions };
        })
      );
      return { results };
    } catch (err) {
      if (err instanceof SuggestionParseError) {
        console.error('OpenAI suggestion response malformed', err);
      } else {
        console.error('OpenAI suggestion call failed', err);
      }
      await cooldownStore.clear(cooldownKey(input.tableToken));
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: "Couldn't get suggestions, try again." });
    }
  }),
});
```

- [ ] **Step 9: Update `tests/integration/ai-suggestion-router.test.ts`'s cooldown setup**

This file currently imports `redis` directly and flushes it in `beforeEach` — keep that (still real Redis, still what `RedisCooldownStore` wraps). Add an import and pass `cooldownStore` into every `appRouter.createCaller({ db, user: null })` call in this file (there are 7: lines with `T1`, `T-bulk`, `T-empty`, invalid-token, `T2`, `T3`, `T4` test cases).

Add near the top imports:
```ts
import { RedisCooldownStore } from '@/server/cooldownStore';
```

Then change every occurrence of:
```ts
const anon = appRouter.createCaller({ db, user: null });
```
to:
```ts
const anon = appRouter.createCaller({ db, user: null, cooldownStore: new RedisCooldownStore() });
```

(All 7 occurrences in this file follow this exact pattern — a plain find-and-replace of that one line across the file.)

- [ ] **Step 10: Add `RUNTIME_TARGET` to `.env.example`**

Add this line to `.env.example` (with the other top-level config, e.g. near `DATABASE_URL`):
```
RUNTIME_TARGET=node
```

- [ ] **Step 11: Run the full build and test suite**

Run: `npm run build`
Expected: clean, no TypeScript errors.

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" npm test`
Expected: all tests pass, including `tests/integration/ai-suggestion-router.test.ts`'s cooldown-enforcement test and every other integration test's ~50 unrelated `createCaller({ db, user })` call sites (these must NOT need updating — if any of them fail to compile because `cooldownStore` was made non-optional by mistake, that's a defect in this task, not in those tests: `cooldownStore` must be optional on `Context`).

- [ ] **Step 12: Commit**

```bash
git add src/server/cooldownStore.ts src/server/db.cloudflare.ts src/server/trpc/context.ts src/server/trpc/routers/aiSuggestion.ts tests/unit/cooldownStore.test.ts tests/integration/ai-suggestion-router.test.ts .env.example
git rm src/server/ai/cooldown.ts tests/unit/ai-cooldown.test.ts
git commit -m "$(cat <<'EOF'
Make request context runtime-aware for Cloudflare Workers support

Postgres and the AI-suggestion cooldown guard are the only two things
that need branching between the node and cloudflare runtime targets --
Hyperdrive and KV are request-scoped bindings, not plain env vars, so
their client construction has to happen per-request inside
createContext() rather than at module load time the way the existing
Node singletons work.

Introduces a CooldownStore interface with Redis (node) and KV
(cloudflare) implementations, selected by RUNTIME_TARGET. cooldownStore
is optional on the Context type even though createContext() always
populates it, so the ~50 existing test call sites that construct a
Context by hand don't need to plumb through a store they never touch --
only the one test that actually exercises cooldown behavior does.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: OpenNext/Wrangler build and deploy tooling

**Files:**
- Modify: `package.json` (new dev dependencies, new scripts)
- Create: `wrangler.jsonc`

**Interfaces:**
- Consumes: `HYPERDRIVE` and `COOLDOWN_KV` binding names from Task 2 (must match exactly what `src/server/db.cloudflare.ts` and `src/server/trpc/context.ts` read).
- Produces: `npm run build:cf`, `npm run preview:cf`, `npm run deploy:cf` scripts.

This task can run before, after, or independently of Task 2 (no shared files), but should be sequenced last since it's the one task that can't be fully exercised without a real Cloudflare account.

- [ ] **Step 1: Install the OpenNext Cloudflare adapter and Wrangler**

Run: `npm install -D @opennextjs/cloudflare wrangler`

- [ ] **Step 2: Confirm the adapter's actual CLI commands**

Run: `npx opennextjs-cloudflare --help`

Confirm the subcommands are `build`, `preview`, and `deploy` (this plan assumes so based on the adapter's documented interface, but the installed version's `--help` output is the authority — if the actual subcommands differ, use the real ones in Step 3 instead of what's written here).

- [ ] **Step 3: Add `build:cf`/`preview:cf`/`deploy:cf` scripts to `package.json`**

In the `"scripts"` block, alongside the existing `dev`/`build`/`start`/`test` (leave those untouched):
```json
"build:cf": "opennextjs-cloudflare build",
"preview:cf": "opennextjs-cloudflare preview",
"deploy:cf": "opennextjs-cloudflare deploy"
```

- [ ] **Step 4: Create `wrangler.jsonc`**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "pos-app",
  "main": ".open-next/worker.js",
  "compatibility_date": "2024-09-23",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": ".open-next/assets",
    "binding": "ASSETS"
  },
  // Binding IDs below are filled in at actual deploy time (see
  // prd/v4_cloudflare_deployment.md's "Migration steps at actual deploy
  // time") -- they are not secrets to guess or hardcode here, and this repo
  // has no Cloudflare account wired up yet.
  "hyperdrive": [
    {
      "binding": "HYPERDRIVE",
      "id": "REPLACE_AT_DEPLOY_TIME"
    }
  ],
  "kv_namespaces": [
    {
      "binding": "COOLDOWN_KV",
      "id": "REPLACE_AT_DEPLOY_TIME"
    }
  ]
}
```

If Step 2's `--help` output shows a different expected `main`/`assets` layout for the installed adapter version, use that instead — cross-check against the adapter's own get-started template (`npx opennextjs-cloudflare` scaffolds a reference `wrangler.jsonc` on first run in some versions; if so, diff it against the above and reconcile).

- [ ] **Step 5: Verify the Cloudflare build succeeds locally**

Run: `npm run build:cf`

Expected: completes without error. This does not require real Hyperdrive/KV IDs — it only bundles the already-passing `next build` output into a Workers-compatible bundle; it does not start a server or hit any binding. If it fails, the failure is a real defect in this task (missing config, wrong adapter version assumption) and must be fixed before moving on — this is the task's actual automated verification, standing in for a unit test on an infra/tooling change.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json wrangler.jsonc
git commit -m "$(cat <<'EOF'
Add OpenNext Cloudflare build/deploy tooling

Adds @opennextjs/cloudflare + wrangler as dev dependencies, new
build:cf/preview:cf/deploy:cf scripts, and a wrangler.jsonc with the
HYPERDRIVE and COOLDOWN_KV bindings the runtime-aware context (see
previous commit) expects to find. Binding IDs are deploy-time secrets
left as placeholders -- this repo has no Cloudflare account wired up
yet; see prd/v4_cloudflare_deployment.md's deploy-time migration steps
for what happens next, outside this plan's scope.

Existing dev/build/start/test scripts are untouched -- the Node
deploy path keeps working exactly as before.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

**Note for whoever actually deploys this:** before `npm run deploy:cf` can work for real, someone needs to (1) create the Neon Postgres project and run `prisma migrate deploy` against it, (2) create the Cloudflare KV namespace and Hyperdrive config and replace the `REPLACE_AT_DEPLOY_TIME` IDs in `wrangler.jsonc`, (3) create the R2 bucket/API token and set `S3_*` secrets, (4) `wrangler secret put` for `JWT_SECRET`, `ABLY_API_KEY`, `OPENAI_API_KEY`, `OPENAI_MODEL`, and (5) run a manual `wrangler dev`/OpenNext preview smoke test against a real preview environment before the first real deploy. None of this is part of this plan — it's infrastructure provisioning, not code.
