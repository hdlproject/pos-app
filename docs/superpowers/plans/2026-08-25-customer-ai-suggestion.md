# Customer AI Menu Suggestion Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a customer on the QR order page get AI-suggested menu items from a hidden-by-default chat panel, based on tappable taste/aroma/texture/type preferences plus optional free-text notes, with one-tap add-to-cart on each suggestion.

**Architecture:** A new `aiSuggestion` tRPC router (`getSuggestion`, `publicProcedure`) builds a prompt from the customer's preferences and the currently-available menu, calls OpenAI's Chat Completions API in JSON mode via a thin server-only fetch wrapper, validates the response against the real menu (dropping any hallucinated item id), and returns display-ready suggestion cards. A Redis `SET ... NX EX` cooldown guards the endpoint per table token. Everything is ephemeral — no new tables, no persistence beyond the cooldown key. The frontend adds a self-contained `SuggestionChat` component (its own file, to keep the already-large customer page from growing further) wired into the existing cart state via a passed-in `addToCart` callback — no new cart mechanism.

**Tech Stack:** Next.js 16 App Router, tRPC v11, Prisma 7.9.1/Postgres, Redis (ioredis), Tailwind v4, motion (Framer Motion), Vitest.

## Global Constraints

- No new Prisma models/migrations — the spec (`prd/v2_customer_ai_integration.md`) requires this stay fully ephemeral.
- The OpenAI API key must never reach the browser — all AI calls happen in the `aiSuggestion` router / its server-only helper modules.
- `getSuggestion` is a `publicProcedure` (QR customers have no login) — it must be rate-limited (Redis cooldown, one request per 30 seconds per table token) since it's a public endpoint calling a paid API.
- Never suggest an unavailable menu item — the menu payload sent to the AI is always `menuItem.findMany({ where: { available: true, outOfStockReason: null } })`, the same set customers can already order from.
- AI response `menuItemId`s not present in that same available-menu set (hallucinated, or race with availability changing) must be silently dropped, never surfaced to the customer.
- `MenuItem` has no `description` field in the schema — the prompt's menu payload is `id`, `name`, `category name`, `price` only. Do not add a description field or any other schema change.
- Follow the codebase's established TS2589 workaround (explicit flat local type + `as unknown as X` cast) for any Prisma query result with nested includes, matching `menu.ts`'s `MenuItemWithCategory` and `order.ts`'s several examples.
- `DATABASE_URL` must always be passed explicitly on the test command line, never sourced from `.env` — every test run in this plan uses:
  `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" S3_PUBLIC_URL="http://localhost:9000" npm test`
  (Redis/Ably env vars are already loaded from `.env` by Vitest's own env loading, same as every existing test — no DB-safety concern there, only `DATABASE_URL` gets the explicit-always rule.)
- Working directly on `master`, no worktree (matches every prior feature this session) — do not create one.
- Run `npm run build` clean (no TS errors) after every task that touches TypeScript source.

---

### Task 1: Shared suggestion preference option constants

**Files:**
- Create: `src/lib/suggestionOptions.ts`
- Test: `tests/unit/suggestion-options.test.ts`

**Interfaces:**
- Consumes: nothing (pure data, no dependencies)
- Produces: `TASTE_OPTIONS`, `AROMA_OPTIONS`, `TEXTURE_OPTIONS` — each a `readonly string[]` (as-const tuple), importable from both server (zod enum validation) and client (chip rendering) code. Exact values, used verbatim by later tasks:
  - `TASTE_OPTIONS = ['Sweet', 'Sour', 'Bitter', 'Salty', 'Spicy', 'Umami'] as const`
  - `AROMA_OPTIONS = ['Floral', 'Fruity', 'Nutty', 'Roasted', 'Earthy', 'Herbal'] as const`
  - `TEXTURE_OPTIONS = ['Crunchy', 'Creamy', 'Chewy', 'Crispy', 'Smooth', 'Juicy'] as const`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/suggestion-options.test.ts
import { describe, it, expect } from 'vitest';
import { TASTE_OPTIONS, AROMA_OPTIONS, TEXTURE_OPTIONS } from '@/lib/suggestionOptions';

describe('suggestion preference options', () => {
  it('each option list is non-empty with unique, non-empty string values', () => {
    for (const options of [TASTE_OPTIONS, AROMA_OPTIONS, TEXTURE_OPTIONS]) {
      expect(options.length).toBeGreaterThan(0);
      expect(new Set(options).size).toBe(options.length);
      for (const opt of options) {
        expect(typeof opt).toBe('string');
        expect(opt.length).toBeGreaterThan(0);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" S3_PUBLIC_URL="http://localhost:9000" npx vitest run tests/unit/suggestion-options.test.ts`
Expected: FAIL — `Cannot find module '@/lib/suggestionOptions'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/suggestionOptions.ts
export const TASTE_OPTIONS = ['Sweet', 'Sour', 'Bitter', 'Salty', 'Spicy', 'Umami'] as const;
export const AROMA_OPTIONS = ['Floral', 'Fruity', 'Nutty', 'Roasted', 'Earthy', 'Herbal'] as const;
export const TEXTURE_OPTIONS = ['Crunchy', 'Creamy', 'Chewy', 'Crispy', 'Smooth', 'Juicy'] as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add src/lib/suggestionOptions.ts tests/unit/suggestion-options.test.ts
git commit -m "feat: add shared taste/aroma/texture option constants for AI suggestion chat"
```

---

### Task 2: Suggestion prompt-building and response-parsing (pure logic)

**Files:**
- Create: `src/server/ai/suggestion.ts`
- Test: `tests/unit/ai-suggestion.test.ts`

**Interfaces:**
- Consumes: nothing external (pure functions, no network/DB/Redis)
- Produces (used by Task 5's router):
  - `type SuggestionPreferences = { taste: string[]; aroma: string[]; texture: string[]; type: string[]; notes?: string }`
  - `type SuggestionMenuItem = { id: string; name: string; category: string; price: number }`
  - `type SuggestionResult = { menuItemId: string; reason: string }`
  - `type SuggestionMessage = { role: 'system' | 'user'; content: string }`
  - `buildSuggestionMessages(preferences: SuggestionPreferences, menuItems: SuggestionMenuItem[]): SuggestionMessage[]`
  - `parseSuggestionResponse(raw: string, menuItems: SuggestionMenuItem[]): SuggestionResult[]` — validates against `menuItems`, drops unresolvable ids, caps at 5 results
  - `class SuggestionParseError extends Error {}` — thrown when `raw` isn't valid JSON or doesn't have the expected `{ suggestions: [...] }` shape at all (as opposed to individual bad entries, which are just dropped)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/ai-suggestion.test.ts
import { describe, it, expect } from 'vitest';
import {
  buildSuggestionMessages,
  parseSuggestionResponse,
  SuggestionParseError,
  type SuggestionMenuItem,
} from '@/server/ai/suggestion';

const menu: SuggestionMenuItem[] = [
  { id: 'm1', name: 'Latte', category: 'Coffee', price: 28000 },
  { id: 'm2', name: 'Chamomile', category: 'Tea', price: 17000 },
];

describe('buildSuggestionMessages', () => {
  it('includes preferences and every menu item id/name in the user message', () => {
    const messages = buildSuggestionMessages(
      { taste: ['Sweet'], aroma: [], texture: ['Creamy'], type: ['Coffee'], notes: 'no nuts please' },
      menu
    );
    expect(messages[0].role).toBe('system');
    const userContent = messages[1].content;
    expect(userContent).toContain('Sweet');
    expect(userContent).toContain('Creamy');
    expect(userContent).toContain('Coffee');
    expect(userContent).toContain('no nuts please');
    expect(userContent).toContain('m1');
    expect(userContent).toContain('Latte');
    expect(userContent).toContain('m2');
    expect(userContent).toContain('Chamomile');
  });

  it('handles no preferences selected at all without throwing', () => {
    const messages = buildSuggestionMessages({ taste: [], aroma: [], texture: [], type: [] }, menu);
    expect(messages).toHaveLength(2);
  });
});

describe('parseSuggestionResponse', () => {
  it('parses valid suggestions matching real menu items', () => {
    const raw = JSON.stringify({ suggestions: [{ menuItemId: 'm1', reason: 'Sweet and creamy' }] });
    const result = parseSuggestionResponse(raw, menu);
    expect(result).toEqual([{ menuItemId: 'm1', reason: 'Sweet and creamy' }]);
  });

  it('drops suggestions with an id not present in the menu', () => {
    const raw = JSON.stringify({
      suggestions: [
        { menuItemId: 'm1', reason: 'Real item' },
        { menuItemId: 'does-not-exist', reason: 'Hallucinated' },
      ],
    });
    const result = parseSuggestionResponse(raw, menu);
    expect(result).toEqual([{ menuItemId: 'm1', reason: 'Real item' }]);
  });

  it('caps results at 5 even if the model returns more', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ menuItemId: 'm1', reason: `reason ${i}` }));
    const raw = JSON.stringify({ suggestions: many });
    const result = parseSuggestionResponse(raw, menu);
    expect(result).toHaveLength(5);
  });

  it('throws SuggestionParseError on invalid JSON', () => {
    expect(() => parseSuggestionResponse('not json', menu)).toThrow(SuggestionParseError);
  });

  it('throws SuggestionParseError when the suggestions array is missing', () => {
    expect(() => parseSuggestionResponse(JSON.stringify({ foo: 'bar' }), menu)).toThrow(SuggestionParseError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" S3_PUBLIC_URL="http://localhost:9000" npx vitest run tests/unit/ai-suggestion.test.ts`
Expected: FAIL — `Cannot find module '@/server/ai/suggestion'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/ai/suggestion.ts
export type SuggestionPreferences = {
  taste: string[];
  aroma: string[];
  texture: string[];
  type: string[];
  notes?: string;
};

export type SuggestionMenuItem = { id: string; name: string; category: string; price: number };
export type SuggestionResult = { menuItemId: string; reason: string };
export type SuggestionMessage = { role: 'system' | 'user'; content: string };

export class SuggestionParseError extends Error {}

const SYSTEM_PROMPT =
  'You are a menu recommendation assistant for a cafe. Given a customer\'s preferences and the ' +
  'current available menu, recommend up to 5 items that best match. Always recommend your best ' +
  'guesses even if the match is imperfect -- never return an empty list if the menu is non-empty. ' +
  'Respond with ONLY a JSON object of the exact shape ' +
  '{"suggestions":[{"menuItemId":"<id from the menu list>","reason":"<one short sentence>"}]}, ' +
  'using menuItemId values taken verbatim from the provided menu -- never invent an id.';

export function buildSuggestionMessages(
  preferences: SuggestionPreferences,
  menuItems: SuggestionMenuItem[]
): SuggestionMessage[] {
  const menuLines = menuItems.map((m) => `- id=${m.id} | ${m.name} | ${m.category} | Rp${m.price}`).join('\n');

  const prefLines = [
    preferences.taste.length ? `Taste: ${preferences.taste.join(', ')}` : null,
    preferences.aroma.length ? `Aroma: ${preferences.aroma.join(', ')}` : null,
    preferences.texture.length ? `Texture: ${preferences.texture.join(', ')}` : null,
    preferences.type.length ? `Type: ${preferences.type.join(', ')}` : null,
    preferences.notes ? `Notes: ${preferences.notes}` : null,
  ].filter((line): line is string => line !== null);

  const user =
    `Customer preferences:\n${prefLines.length ? prefLines.join('\n') : '(no specific preferences given)'}\n\n` +
    `Available menu:\n${menuLines}`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}

export function parseSuggestionResponse(raw: string, menuItems: SuggestionMenuItem[]): SuggestionResult[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SuggestionParseError('AI response was not valid JSON');
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { suggestions?: unknown }).suggestions)
  ) {
    throw new SuggestionParseError('AI response missing a suggestions array');
  }

  const validIds = new Set(menuItems.map((m) => m.id));
  const results: SuggestionResult[] = [];
  for (const entry of (parsed as { suggestions: unknown[] }).suggestions) {
    if (
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { menuItemId?: unknown }).menuItemId === 'string' &&
      typeof (entry as { reason?: unknown }).reason === 'string' &&
      validIds.has((entry as { menuItemId: string }).menuItemId)
    ) {
      const e = entry as { menuItemId: string; reason: string };
      results.push({ menuItemId: e.menuItemId, reason: e.reason });
    }
  }
  return results.slice(0, 5);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/ai/suggestion.ts tests/unit/ai-suggestion.test.ts
git commit -m "feat: add pure prompt-building and response-parsing logic for AI menu suggestions"
```

---

### Task 3: OpenAI client wrapper

**Files:**
- Create: `src/server/ai/openaiClient.ts`
- Modify: `.env.example`, `.env`
- Test: `tests/unit/openai-client.test.ts`

**Interfaces:**
- Consumes: `SuggestionMessage` type from Task 2 (`src/server/ai/suggestion.ts`)
- Produces (used by Task 5's router): `fetchChatCompletion(messages: SuggestionMessage[]): Promise<string>` — POSTs to OpenAI's Chat Completions API with `response_format: { type: 'json_object' }`, returns the assistant message's raw content string, throws a plain `Error` on a non-OK response or a missing/malformed response body.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/openai-client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchChatCompletion } from '@/server/ai/openaiClient';

describe('fetchChatCompletion', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_MODEL;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_MODEL = 'test-model';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalKey;
    process.env.OPENAI_MODEL = originalModel;
    vi.restoreAllMocks();
  });

  it('posts the messages to the chat completions endpoint and returns the content', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('test-model');
      expect(body.messages).toEqual([{ role: 'system', content: 'sys' }]);
      expect(body.response_format).toEqual({ type: 'json_object' });
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '{"suggestions":[]}' } }] }),
      } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchChatCompletion([{ role: 'system', content: 'sys' }]);
    expect(result).toBe('{"suggestions":[]}');
  });

  it('throws when the response is not ok', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500 }) as Response) as unknown as typeof fetch;
    await expect(fetchChatCompletion([{ role: 'system', content: 'sys' }])).rejects.toThrow();
  });

  it('throws when the response has no message content', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [] }),
    }) as Response) as unknown as typeof fetch;
    await expect(fetchChatCompletion([{ role: 'system', content: 'sys' }])).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" S3_PUBLIC_URL="http://localhost:9000" npx vitest run tests/unit/openai-client.test.ts`
Expected: FAIL — `Cannot find module '@/server/ai/openaiClient'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/ai/openaiClient.ts
import type { SuggestionMessage } from './suggestion';

export async function fetchChatCompletion(messages: SuggestionMessage[]): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL,
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI request failed with status ${res.status}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('OpenAI response missing message content');
  }
  return content;
}
```

Add the two new env vars, matching the existing empty-value convention in `.env.example` and populating a sensible non-secret default (model name only) in the local `.env`:

```bash
# .env.example -- append
OPENAI_API_KEY=
OPENAI_MODEL=
```

```bash
# .env -- append (leave the key blank; fill in a real key manually for live manual testing -- automated tests mock fetch and never call OpenAI for real)
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/ai/openaiClient.ts .env.example .env
git commit -m "feat: add server-only OpenAI chat completions client for menu suggestions"
```

---

### Task 4: Redis cooldown guard

**Files:**
- Create: `src/server/ai/cooldown.ts`
- Test: `tests/unit/ai-cooldown.test.ts`

**Interfaces:**
- Consumes: `redis` from `src/server/redis.ts` (existing singleton)
- Produces (used by Task 5's router): `checkAndSetCooldown(tableToken: string): Promise<boolean>` — returns `true` and atomically starts a 30-second cooldown if none is active for that table token, `false` if one is already active (request must be rejected).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/ai-cooldown.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { redis } from '@/server/redis';
import { checkAndSetCooldown } from '@/server/ai/cooldown';

describe('checkAndSetCooldown', () => {
  beforeEach(async () => {
    await redis.flushdb();
  });

  it('allows the first request for a table token', async () => {
    await expect(checkAndSetCooldown('table-a')).resolves.toBe(true);
  });

  it('blocks a second request for the same table token within the cooldown window', async () => {
    await checkAndSetCooldown('table-a');
    await expect(checkAndSetCooldown('table-a')).resolves.toBe(false);
  });

  it('tracks cooldowns independently per table token', async () => {
    await checkAndSetCooldown('table-a');
    await expect(checkAndSetCooldown('table-b')).resolves.toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" S3_PUBLIC_URL="http://localhost:9000" npx vitest run tests/unit/ai-cooldown.test.ts`
Expected: FAIL — `Cannot find module '@/server/ai/cooldown'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/ai/cooldown.ts
import { redis } from '../redis';

const COOLDOWN_SECONDS = 30;

export async function checkAndSetCooldown(tableToken: string): Promise<boolean> {
  const key = `ai-suggest-cooldown:${tableToken}`;
  const result = await redis.set(key, '1', 'EX', COOLDOWN_SECONDS, 'NX');
  return result === 'OK';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/ai/cooldown.ts tests/unit/ai-cooldown.test.ts
git commit -m "feat: add Redis-backed per-table cooldown guard for AI suggestions"
```

---

### Task 5: `aiSuggestion` tRPC router

**Files:**
- Create: `src/server/trpc/routers/aiSuggestion.ts`
- Modify: `src/server/trpc/routers/_app.ts`
- Test: `tests/integration/ai-suggestion-router.test.ts`

**Interfaces:**
- Consumes:
  - `TASTE_OPTIONS`, `AROMA_OPTIONS`, `TEXTURE_OPTIONS` (Task 1, `@/lib/suggestionOptions`)
  - `buildSuggestionMessages`, `parseSuggestionResponse`, `SuggestionParseError`, `SuggestionMenuItem` (Task 2, `../../ai/suggestion`)
  - `fetchChatCompletion` (Task 3, `../../ai/openaiClient`)
  - `checkAndSetCooldown` (Task 4, `../../ai/cooldown`)
  - `router`, `publicProcedure` from `../trpc`
- Produces: `aiSuggestionRouter` registered on `appRouter` as `appRouter.aiSuggestion`, with mutation `getSuggestion`:
  - Input: `{ tableToken: string; taste: string[]; aroma: string[]; texture: string[]; type: string[]; notes?: string }`
  - Output: `{ suggestions: { menuItemId: string; name: string; price: string; image: string | null; categoryName: string; reason: string }[] }`

This task mocks `../../ai/openaiClient` (Task 3) via `vi.mock` so the integration test never calls the real OpenAI API, while exercising the real Postgres test DB and real Redis (matching this codebase's existing integration-test style of `appRouter.createCaller` against real `db`/`redis`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/ai-suggestion-router.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/server/db';
import { redis } from '@/server/redis';
import { resetDb } from '../helpers/db';

vi.mock('@/server/ai/openaiClient', () => ({
  fetchChatCompletion: vi.fn(),
}));

import { fetchChatCompletion } from '@/server/ai/openaiClient';
import { appRouter } from '@/server/trpc/routers/_app';

const mockedFetch = vi.mocked(fetchChatCompletion);

describe('aiSuggestion router', () => {
  beforeEach(async () => {
    await resetDb();
    await redis.flushdb();
    mockedFetch.mockReset();
  });

  it('returns validated suggestions built from the available menu', async () => {
    const table = await db.table.create({ data: { label: 'T1', qrToken: 'tok-1' } });
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    const item = await db.menuItem.create({
      data: { name: 'Latte', price: 28000, categoryId: category.id, available: true },
    });
    await db.menuItem.create({
      data: { name: 'Hidden', price: 10000, categoryId: category.id, available: false },
    });
    mockedFetch.mockResolvedValue(
      JSON.stringify({ suggestions: [{ menuItemId: item.id, reason: 'Sweet and creamy' }] })
    );

    const anon = appRouter.createCaller({ db, user: null });
    const result = await anon.aiSuggestion.getSuggestion({
      tableToken: table.qrToken,
      taste: ['Sweet'],
      aroma: [],
      texture: ['Creamy'],
      type: ['Coffee'],
    });

    expect(result.suggestions).toEqual([
      {
        menuItemId: item.id,
        name: 'Latte',
        price: '28000',
        image: null,
        categoryName: 'Coffee',
        reason: 'Sweet and creamy',
      },
    ]);
    // the unavailable "Hidden" item must never reach the prompt
    const promptText = mockedFetch.mock.calls[0][0].map((m) => m.content).join('\n');
    expect(promptText).not.toContain('Hidden');
  });

  it('rejects an invalid table token', async () => {
    const anon = appRouter.createCaller({ db, user: null });
    await expect(
      anon.aiSuggestion.getSuggestion({ tableToken: 'not-a-real-token', taste: [], aroma: [], texture: [], type: [] })
    ).rejects.toThrow();
  });

  it('enforces the per-table cooldown on a second immediate request', async () => {
    const table = await db.table.create({ data: { label: 'T2', qrToken: 'tok-2' } });
    const category = await db.category.create({ data: { name: 'Tea', sortOrder: 1 } });
    await db.menuItem.create({ data: { name: 'Chamomile', price: 17000, categoryId: category.id, available: true } });
    mockedFetch.mockResolvedValue(JSON.stringify({ suggestions: [] }));

    const anon = appRouter.createCaller({ db, user: null });
    const input = { tableToken: table.qrToken, taste: [], aroma: [], texture: [], type: [] };
    await anon.aiSuggestion.getSuggestion(input);
    await expect(anon.aiSuggestion.getSuggestion(input)).rejects.toThrow();
  });

  it('returns no suggestions without calling OpenAI when the menu is empty', async () => {
    const table = await db.table.create({ data: { label: 'T3', qrToken: 'tok-3' } });
    const anon = appRouter.createCaller({ db, user: null });
    const result = await anon.aiSuggestion.getSuggestion({
      tableToken: table.qrToken,
      taste: [],
      aroma: [],
      texture: [],
      type: [],
    });
    expect(result.suggestions).toEqual([]);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('surfaces a clear error when the AI call fails', async () => {
    const table = await db.table.create({ data: { label: 'T4', qrToken: 'tok-4' } });
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    await db.menuItem.create({ data: { name: 'Latte', price: 28000, categoryId: category.id, available: true } });
    mockedFetch.mockRejectedValue(new Error('network down'));

    const anon = appRouter.createCaller({ db, user: null });
    await expect(
      anon.aiSuggestion.getSuggestion({ tableToken: table.qrToken, taste: [], aroma: [], texture: [], type: [] })
    ).rejects.toThrow(/couldn.t get suggestions/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" S3_PUBLIC_URL="http://localhost:9000" npx vitest run tests/integration/ai-suggestion-router.test.ts`
Expected: FAIL — `appRouter.aiSuggestion` is undefined

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/trpc/routers/aiSuggestion.ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { TASTE_OPTIONS, AROMA_OPTIONS, TEXTURE_OPTIONS } from '../../../lib/suggestionOptions';
import { checkAndSetCooldown } from '../../ai/cooldown';
import { buildSuggestionMessages, parseSuggestionResponse, SuggestionParseError } from '../../ai/suggestion';
import { fetchChatCompletion } from '../../ai/openaiClient';

const suggestionInput = z.object({
  tableToken: z.string(),
  taste: z.array(z.enum(TASTE_OPTIONS)).max(TASTE_OPTIONS.length),
  aroma: z.array(z.enum(AROMA_OPTIONS)).max(AROMA_OPTIONS.length),
  texture: z.array(z.enum(TEXTURE_OPTIONS)).max(TEXTURE_OPTIONS.length),
  type: z.array(z.string().max(60)).max(10),
  notes: z.string().max(200).optional(),
});

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

    const items = (await ctx.db.menuItem.findMany({
      where: { available: true, outOfStockReason: null },
      include: { category: true },
    })) as unknown as SuggestionMenuRow[];

    if (items.length === 0) {
      return { suggestions: [] };
    }

    const menuForAi = items.map((i) => ({ id: i.id, name: i.name, category: i.category.name, price: Number(i.price) }));
    const messages = buildSuggestionMessages(
      { taste: input.taste, aroma: input.aroma, texture: input.texture, type: input.type, notes: input.notes },
      menuForAi
    );

    let raw: string;
    try {
      raw = await fetchChatCompletion(messages);
    } catch (err) {
      console.error('OpenAI suggestion call failed', err);
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: "Couldn't get suggestions, try again." });
    }

    let parsed: ReturnType<typeof parseSuggestionResponse>;
    try {
      parsed = parseSuggestionResponse(raw, menuForAi);
    } catch (err) {
      if (err instanceof SuggestionParseError) {
        console.error('OpenAI suggestion response malformed', err);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: "Couldn't get suggestions, try again." });
      }
      throw err;
    }

    const byId = new Map(items.map((i) => [i.id, i]));
    const suggestions = parsed
      .map((p) => {
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
      .filter((s): s is NonNullable<typeof s> => s !== null);

    return { suggestions };
  }),
});
```

Register it in `_app.ts`:

```ts
// src/server/trpc/routers/_app.ts
import { router } from '../trpc';
import { authRouter } from './auth';
import { menuRouter } from './menu';
import { ingredientRouter } from './ingredient';
import { tableRouter } from './table';
import { orderRouter } from './order';
import { kitchenRouter } from './kitchen';
import { paymentRouter } from './payment';
import { reportRouter } from './report';
import { stockBatchRouter } from './stockBatch';
import { aiSuggestionRouter } from './aiSuggestion';

export const appRouter = router({
  auth: authRouter,
  menu: menuRouter,
  ingredient: ingredientRouter,
  table: tableRouter,
  order: orderRouter,
  kitchen: kitchenRouter,
  payment: paymentRouter,
  report: reportRouter,
  stockBatch: stockBatchRouter,
  aiSuggestion: aiSuggestionRouter,
});

export type AppRouter = typeof appRouter;
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2
Expected: PASS (5 tests)

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" S3_PUBLIC_URL="http://localhost:9000" npm test`
Expected: PASS, all files (existing suite + the new ones from Tasks 1-5)

- [ ] **Step 6: Commit**

```bash
git add src/server/trpc/routers/aiSuggestion.ts src/server/trpc/routers/_app.ts tests/integration/ai-suggestion-router.test.ts
git commit -m "feat: add aiSuggestion.getSuggestion tRPC endpoint"
```

---

### Task 6: `SuggestionChat` frontend component and page wiring

**Files:**
- Create: `src/app/order/[tableToken]/SuggestionChat.tsx`
- Modify: `src/app/order/[tableToken]/page.tsx`

**Interfaces:**
- Consumes: `trpc.aiSuggestion.getSuggestion` (Task 5), `TASTE_OPTIONS`/`AROMA_OPTIONS`/`TEXTURE_OPTIONS` (Task 1), existing `Button`/`Chip`/`MenuItemThumbnail`/`Card` UI components, and from the parent page: `tableToken: string`, `categories: string[]` (already computed in `page.tsx`, minus the synthetic `'All'` entry), `availableMenuItemIds: string[]` (the ids of `items`, the page's already-loaded `menu.listAvailable` result — used to catch a suggestion that's gone unavailable since the suggestion call, per the spec's stale-item requirement, with zero extra network calls since this list is already in memory and kept current by the page's own query), and `onAddToCart: (menuItemId: string) => void` (the page's existing `addToCart` function — same one the menu grid's "+ Add" button already calls, so a suggested item that's still available lands in the cart exactly like any other).
- Produces: default-exported `SuggestionChat` component with props `{ tableToken: string; categories: string[]; availableMenuItemIds: string[]; onAddToCart: (menuItemId: string) => void }`, rendering its own floating toggle button + overlay panel; no exports consumed by anything beyond `page.tsx`.

This task is frontend-only with no existing automated test pattern for this page (it's a manual-testing surface per the spec's Testing section) — verified via `npm run build` (TypeScript) and a manual click-through instead of a unit test.

- [ ] **Step 1: Create the component**

```tsx
// src/app/order/[tableToken]/SuggestionChat.tsx
'use client';
import { useState } from 'react';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { MenuItemThumbnail } from '@/components/ui/MenuItemThumbnail';
import { TASTE_OPTIONS, AROMA_OPTIONS, TEXTURE_OPTIONS } from '@/lib/suggestionOptions';

// Explicit flat type for the mutation result -- same TS2589 workaround
// used throughout this page for tRPC results.
type Suggestion = {
  menuItemId: string;
  name: string;
  price: string;
  image: string | null;
  categoryName: string;
  reason: string;
};

function toggleValue(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export default function SuggestionChat({
  tableToken,
  categories,
  availableMenuItemIds,
  onAddToCart,
}: {
  tableToken: string;
  categories: string[];
  availableMenuItemIds: string[];
  onAddToCart: (menuItemId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [taste, setTaste] = useState<string[]>([]);
  const [aroma, setAroma] = useState<string[]>([]);
  const [texture, setTexture] = useState<string[]>([]);
  const [type, setType] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [addedIds, setAddedIds] = useState<string[]>([]);
  const [unavailableIds, setUnavailableIds] = useState<string[]>([]);

  const suggest = trpc.aiSuggestion.getSuggestion.useMutation();

  function submit() {
    setAddedIds([]);
    setUnavailableIds([]);
    suggest.mutate({ tableToken, taste, aroma, texture, type, notes: notes.trim() || undefined });
  }

  // Suggestions come from a snapshot taken when "Get suggestions" was
  // tapped -- by the time the customer taps Add, that item may have gone
  // unavailable (86'd, marked out of stock). availableMenuItemIds is the
  // page's live menu.listAvailable result, already in memory, so this is
  // a free re-check with no extra request -- same guarantee the spec asks
  // for, without inventing a new server round-trip nothing else here has.
  function handleAdd(menuItemId: string) {
    if (!availableMenuItemIds.includes(menuItemId)) {
      setUnavailableIds((ids) => [...ids, menuItemId]);
      return;
    }
    onAddToCart(menuItemId);
    setAddedIds((ids) => [...ids, menuItemId]);
  }

  const suggestions = (suggest.data as unknown as { suggestions: Suggestion[] } | undefined)?.suggestions ?? [];

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Get menu suggestions"
        className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-30 flex items-center gap-2 bg-accent text-white font-extrabold text-sm px-4 py-2.5 rounded-full shadow-2xl"
      >
        ✨ Suggest for me
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-dark-ui/60 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="w-full max-w-[420px] max-h-[85vh] bg-surface rounded-3xl overflow-hidden shadow-2xl flex flex-col">
            <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-border shrink-0">
              <div className="font-display text-xl text-text">What are you in the mood for?</div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="w-8 h-8 rounded-lg bg-surface-input text-accent-tint flex items-center justify-center shrink-0"
              >
                ✕
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex flex-col gap-4">
              <div>
                <div className="text-xs font-extrabold text-text-muted-2 uppercase mb-2">Taste</div>
                <div className="flex gap-2 flex-wrap">
                  {TASTE_OPTIONS.map((o) => (
                    <Chip key={o} active={taste.includes(o)} onClick={() => setTaste((t) => toggleValue(t, o))}>
                      {o}
                    </Chip>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-extrabold text-text-muted-2 uppercase mb-2">Aroma</div>
                <div className="flex gap-2 flex-wrap">
                  {AROMA_OPTIONS.map((o) => (
                    <Chip key={o} active={aroma.includes(o)} onClick={() => setAroma((a) => toggleValue(a, o))}>
                      {o}
                    </Chip>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-extrabold text-text-muted-2 uppercase mb-2">Texture</div>
                <div className="flex gap-2 flex-wrap">
                  {TEXTURE_OPTIONS.map((o) => (
                    <Chip key={o} active={texture.includes(o)} onClick={() => setTexture((t) => toggleValue(t, o))}>
                      {o}
                    </Chip>
                  ))}
                </div>
              </div>

              {categories.length > 0 && (
                <div>
                  <div className="text-xs font-extrabold text-text-muted-2 uppercase mb-2">Type</div>
                  <div className="flex gap-2 flex-wrap">
                    {categories.map((o) => (
                      <Chip key={o} active={type.includes(o)} onClick={() => setType((t) => toggleValue(t, o))}>
                        {o}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="text-xs font-extrabold text-text-muted-2 uppercase mb-2">Anything else? (optional)</div>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={200}
                  placeholder="e.g. no nuts, something warm"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border-strong bg-surface-input text-text text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>

              <Button variant="primary" className="w-full" disabled={suggest.isPending} onClick={submit}>
                {suggest.isPending ? 'Thinking…' : 'Get suggestions'}
              </Button>

              {suggest.isError && (
                <p className="text-warning text-xs font-semibold text-center">{suggest.error.message}</p>
              )}

              {suggestions.length > 0 && (
                <div className="flex flex-col gap-2.5 pt-1">
                  {suggestions.map((s) => (
                    <div key={s.menuItemId} className="flex items-center gap-3 bg-surface-input rounded-2xl p-2.5">
                      <MenuItemThumbnail
                        image={s.image}
                        categoryName={s.categoryName}
                        alt={s.name}
                        className="w-14 h-14 rounded-xl shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-sm text-text truncate">{s.name}</div>
                        <div className="text-xs text-text-muted">{s.reason}</div>
                        <div className="text-xs font-extrabold text-accent-tint mt-0.5">
                          Rp {Number(s.price).toLocaleString('id-ID')}
                        </div>
                      </div>
                      {unavailableIds.includes(s.menuItemId) ? (
                        <span className="text-[10.5px] font-extrabold uppercase px-2.5 py-1.5 rounded-full bg-surface-input text-text-muted-2 shrink-0">
                          No longer available
                        </span>
                      ) : (
                        <Button
                          variant={addedIds.includes(s.menuItemId) ? 'success' : 'dark'}
                          size="sm"
                          onClick={() => handleAdd(s.menuItemId)}
                        >
                          {addedIds.includes(s.menuItemId) ? 'Added' : '+ Add'}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Wire it into the customer page**

In `src/app/order/[tableToken]/page.tsx`, add the import near the other component imports:

```tsx
import SuggestionChat from './SuggestionChat';
```

Render it once, right before the closing `</div>` of the component's root return (after the `finishedOpen` modal block, still inside the root `<div>`), passing the page's existing `tableToken`, `categories` (drop the synthetic `'All'` entry), the live available-item ids (`items`, already computed as `const items = menu.data ?? [];` earlier in the page), and `addToCart`:

```tsx
      <SuggestionChat
        tableToken={tableToken}
        categories={categories.filter((c) => c !== 'All')}
        availableMenuItemIds={items.map((i) => i.id)}
        onAddToCart={addToCart}
      />
    </div>
  );
}
```

(This replaces the file's existing final two lines, `    </div>\n  );\n}`, with the block above.)

- [ ] **Step 3: Run the build**

Run: `npm run build`
Expected: compiles clean, no TypeScript errors (in particular, confirm no TS2589 from the new `aiSuggestion` router or `SuggestionChat`'s cast)

- [ ] **Step 4: Run the full test suite**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" S3_PUBLIC_URL="http://localhost:9000" npm test`
Expected: PASS, no regressions

- [ ] **Step 5: Manual verification**

With the dev server running and a real `OPENAI_API_KEY` filled into `.env` (restart the dev server after editing `.env` so it picks up the new key):
1. Open `/order/[a real table's qrToken]` on a mobile-width viewport.
2. Confirm the "✨ Suggest for me" button is visible but the panel is closed by default, positioned above the "View cart" floating button once the cart has items (no overlap).
3. Tap it, select a few chips across taste/aroma/texture/type, add a free-text note, tap "Get suggestions" — confirm a loading state, then suggestion cards with photo/name/price/reason.
4. Tap "Add to cart" on a suggestion — confirm it appears in the cart bar/review modal exactly like a normal menu-grid add, and the card's button flips to "Added".
5. Close and reopen the panel — confirm chip/free-text/suggestion state is cleared (fully ephemeral, per spec).
6. Tap "Get suggestions" twice in a row — confirm the second attempt within 30s shows the cooldown message from the server.
7. Repeat steps 1-4 in both One-time Order and Open Table modes.

- [ ] **Step 6: Commit**

```bash
git add "src/app/order/[tableToken]/SuggestionChat.tsx" "src/app/order/[tableToken]/page.tsx"
git commit -m "feat: add AI menu suggestion chat panel to the customer order page"
```

---

## Post-plan note

`npm install openai` was deliberately **not** added — the OpenAI Chat Completions API is called via a plain `fetch` in `openaiClient.ts`, keeping the dependency footprint at zero and the network call trivially mockable in tests (matching how `ably.test.ts` mocks the `ably` package, just one level simpler since there's no SDK to mock at all).
