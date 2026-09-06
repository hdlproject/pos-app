# Menu Item Image Upload (Local S3/MinIO) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the admin menu page's "Image URL" text field with a real file-upload control, storing photos in a local MinIO (S3-compatible) instance run via `docker-compose`.

**Architecture:** A new `minio` service joins the existing `docker-compose.yml`. A server-side `storage.ts` module wraps `@aws-sdk/client-s3`, lazily ensuring a public-read bucket exists, and an ADMIN-gated Next.js route handler (`/api/upload`) validates and proxies uploaded files into it, returning a public URL. `MenuItem.image` keeps storing that URL as a plain string — no schema change. A new `ImageUpload` component replaces the old URL `Input` everywhere it appeared.

**Tech Stack:** `@aws-sdk/client-s3` (AWS SDK v3, S3-compatible), MinIO (Docker), Next.js Route Handlers, existing Prisma/tRPC/React stack.

## Global Constraints

- No change to `MenuItem.image`'s column type — still `String?`, storing a URL.
- Upload flow is proxy-through-Next.js (browser → `/api/upload` → MinIO via SDK), not presigned-URL direct-to-MinIO — chosen to avoid CORS configuration for images this small.
- `/api/upload` requires an authenticated session with role `ADMIN` (matches `menu.createItem`/`updateItem`'s existing gate).
- Max upload size: 5MB. Allowed types: `image/jpeg`, `image/png`, `image/webp`, `image/gif`.
- Bucket name: `menu-images`. MinIO root credentials: `minioadmin`/`minioadmin` (same unauthenticated-for-local-dev posture as this project's existing Postgres/Redis containers).
- `menu.updateItem`'s `image` field becomes nullable (`z.string().nullable().optional()`) so a photo can be genuinely cleared, not just left unchanged — a real gap in the current text-field flow (empty string collapses to `undefined`, which Prisma treats as "leave unchanged").
- No automated test for `ImageUpload` itself (presentational, matches project convention). The upload route gets one integration test (real logic: auth gate + validation).
- Database safety: any `npm test` / `prisma db seed` / `prisma migrate` command must have `DATABASE_URL` set explicitly on that command — never rely on a prior `source .env` (it points at `pos_dev`, the real dev database, not `pos_test`).

---

### Task 1: `docker-compose.yml` MinIO service + env vars

**Files:**
- Modify: `docker-compose.yml` (full current content shown below)
- Modify: `.env`
- Modify: `.env.example`

**Interfaces:**
- Produces: a MinIO container reachable at `http://localhost:9000` (S3 API) and `http://localhost:9001` (web console), and five env vars (`S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_PUBLIC_URL`) that Task 2's `storage.ts` reads.

- [ ] **Step 1: Add the `minio` service to `docker-compose.yml`**

Current full file:

```yaml
services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5433:5432"
    volumes:
      - pos_postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7
    restart: unless-stopped
    ports:
      - "6379:6379"

volumes:
  pos_postgres_data:
```

Replace it with:

```yaml
services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5433:5432"
    volumes:
      - pos_postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7
    restart: unless-stopped
    ports:
      - "6379:6379"

  minio:
    image: minio/minio:latest
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - pos_minio_data:/data

volumes:
  pos_postgres_data:
  pos_minio_data:
```

- [ ] **Step 2: Add the S3 env vars to `.env`**

Current full file:

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/pos_dev
REDIS_URL=redis://localhost:6379
JWT_SECRET=dev-secret-change-in-prod
ABLY_API_KEY=REPLACE_ME
```

Replace it with:

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/pos_dev
REDIS_URL=redis://localhost:6379
JWT_SECRET=dev-secret-change-in-prod
ABLY_API_KEY=REPLACE_ME
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=menu-images
S3_PUBLIC_URL=http://localhost:9000
```

- [ ] **Step 3: Add the same vars to `.env.example`**

Current full file:

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/pos_dev
REDIS_URL=redis://localhost:6379
JWT_SECRET=change-me-in-prod
ABLY_API_KEY=your-ably-key
```

Replace it with:

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/pos_dev
REDIS_URL=redis://localhost:6379
JWT_SECRET=change-me-in-prod
ABLY_API_KEY=your-ably-key
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=menu-images
S3_PUBLIC_URL=http://localhost:9000
```

- [ ] **Step 4: Start MinIO and verify it's reachable**

Run: `docker compose up -d minio`
Then: `curl -sI http://localhost:9000/minio/health/live`
Expected: `HTTP/1.1 200 OK` (MinIO's built-in liveness endpoint).

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml .env .env.example
git commit -m "chore: add local MinIO service and S3 env vars"
```

---

### Task 2: `@aws-sdk/client-s3` dependency + `src/server/storage.ts`

**Files:**
- Modify: `package.json` (add dependency)
- Create: `src/server/storage.ts`

**Interfaces:**
- Consumes: `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_PUBLIC_URL` env vars from Task 1.
- Produces: `uploadMenuImage(bytes: Buffer, filename: string, contentType: string): Promise<string>` — Task 3's route handler imports and calls this.

- [ ] **Step 1: Install the dependency**

Run: `npm install @aws-sdk/client-s3@latest`
Expected: `package.json`'s `dependencies` gains `"@aws-sdk/client-s3": "^<version>"`.

- [ ] **Step 2: Create `src/server/storage.ts`**

```ts
// src/server/storage.ts
import {
  S3Client,
  PutObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
} from '@aws-sdk/client-s3';

const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET_KEY!,
  },
  forcePathStyle: true,
});

const BUCKET = process.env.S3_BUCKET!;
let bucketReady: Promise<void> | undefined;

function ensureBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = (async () => {
      try {
        await client.send(new HeadBucketCommand({ Bucket: BUCKET }));
      } catch {
        await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
        await client.send(
          new PutBucketPolicyCommand({
            Bucket: BUCKET,
            Policy: JSON.stringify({
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Principal: '*',
                  Action: ['s3:GetObject'],
                  Resource: [`arn:aws:s3:::${BUCKET}/*`],
                },
              ],
            }),
          })
        );
      }
    })();
  }
  return bucketReady;
}

export async function uploadMenuImage(
  bytes: Buffer,
  filename: string,
  contentType: string
): Promise<string> {
  await ensureBucket();
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
  const key = `${crypto.randomUUID()}${ext}`;
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: bytes,
      ContentType: contentType,
    })
  );
  return `${process.env.S3_PUBLIC_URL}/${BUCKET}/${key}`;
}
```

`crypto` is used unqualified because Node's `crypto.randomUUID` is available as a global in Node 19+ (no import needed) — this project runs on Node 22 (confirmed via `node --version` in this environment).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds — this file isn't imported anywhere yet, so this just confirms it type-checks standalone.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/server/storage.ts
git commit -m "feat: add S3 client wrapper for menu image uploads"
```

---

### Task 3: `/api/upload` route handler + integration test

**Files:**
- Create: `src/app/api/upload/route.ts`
- Test: `tests/integration/upload-route.test.ts`

**Interfaces:**
- Consumes: `createContext()` from `src/server/trpc/context.ts` (returns `{ db, user }`, where `user` is `{ userId, role, name } | null`); `uploadMenuImage()` from Task 2.
- Produces: `POST` handler at `/api/upload` returning `{ url: string }` (200) or `{ error: string }` (400/401/403). Task 5's `ImageUpload` component calls this endpoint.

- [ ] **Step 1: Create the route handler**

```ts
// src/app/api/upload/route.ts
import { createContext } from '@/server/trpc/context';
import { uploadMenuImage } from '@/server/storage';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export async function POST(request: Request) {
  const { user } = await createContext();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'ADMIN') return Response.json({ error: 'Forbidden' }, { status: 403 });

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return Response.json({ error: 'No file provided' }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return Response.json({ error: 'Unsupported file type' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: 'File too large (max 5MB)' }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const url = await uploadMenuImage(bytes, file.name, file.type);
  return Response.json({ url });
}
```

- [ ] **Step 2: Write the integration test**

```ts
// tests/integration/upload-route.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/server/db';
import { resetDb } from '../helpers/db';
import { hashPin } from '@/server/auth/pin';
import { signSession } from '@/server/auth/session';

// Same in-memory cookie-jar mock used by tests/integration/auth-router.test.ts —
// createContext() calls next/headers' cookies(), which throws outside a real
// request scope. This provides somewhere for a session cookie to live so the
// route handler's createContext() call can read it back.
vi.mock('next/headers', () => {
  const store = new Map<string, string>();
  return {
    cookies: async () => ({
      get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
      set: (name: string, value: string) => {
        store.set(name, value);
      },
      delete: (name: string) => {
        store.delete(name);
      },
    }),
  };
});

import { cookies } from 'next/headers';
import { POST } from '@/app/api/upload/route';

function pngFile(sizeBytes: number, name = 'photo.png'): File {
  return new File([new Uint8Array(sizeBytes)], name, { type: 'image/png' });
}

async function loginAs(role: 'ADMIN' | 'STAFF' | 'KITCHEN') {
  const user = await db.user.create({
    data: { name: role, role, pinHash: await hashPin('1234') },
  });
  const token = signSession({ userId: user.id, role: user.role, name: user.name });
  (await cookies()).set('session', token);
}

describe('upload route', () => {
  beforeEach(resetDb);

  it('uploads a valid image as ADMIN', async () => {
    await loginAs('ADMIN');
    const form = new FormData();
    form.append('file', pngFile(1024));
    const res = await POST(new Request('http://localhost/api/upload', { method: 'POST', body: form }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.url).toMatch(/^http/);
  });

  it('rejects a non-admin STAFF user', async () => {
    await loginAs('STAFF');
    const form = new FormData();
    form.append('file', pngFile(1024));
    const res = await POST(new Request('http://localhost/api/upload', { method: 'POST', body: form }));
    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated request', async () => {
    const form = new FormData();
    form.append('file', pngFile(1024));
    const res = await POST(new Request('http://localhost/api/upload', { method: 'POST', body: form }));
    expect(res.status).toBe(401);
  });

  it('rejects a file over the 5MB limit', async () => {
    await loginAs('ADMIN');
    const form = new FormData();
    form.append('file', pngFile(5 * 1024 * 1024 + 1));
    const res = await POST(new Request('http://localhost/api/upload', { method: 'POST', body: form }));
    expect(res.status).toBe(400);
  });

  it('rejects a non-image content type', async () => {
    await loginAs('ADMIN');
    const form = new FormData();
    form.append('file', new File([new Uint8Array(10)], 'notes.txt', { type: 'text/plain' }));
    const res = await POST(new Request('http://localhost/api/upload', { method: 'POST', body: form }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run the test**

MinIO must be running (Task 1, Step 4) and the S3 env vars must be set explicitly on the test command (do not rely on a prior `source .env` — see Global Constraints).

Run:
```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" \
JWT_SECRET="dev-secret-change-in-prod" \
S3_ENDPOINT="http://localhost:9000" \
S3_ACCESS_KEY="minioadmin" \
S3_SECRET_KEY="minioadmin" \
S3_BUCKET="menu-images" \
S3_PUBLIC_URL="http://localhost:9000" \
npx vitest run tests/integration/upload-route.test.ts
```
Expected: 5/5 tests pass. The "uploads a valid image" test makes a real `PutObject` call against local MinIO — confirm by checking `http://localhost:9001` (MinIO console, login `minioadmin`/`minioadmin`) shows a new object in the `menu-images` bucket after the run.

- [ ] **Step 4: Run the full suite to confirm no regressions**

Run the same env-var-prefixed form with `npm test` instead of the single-file `vitest run` command.
Expected: 38/38 tests pass (33 existing + 5 new — the exact existing count may have shifted since the plan was written; confirm it matches "existing count + 5").

- [ ] **Step 5: Commit**

```bash
git add src/app/api/upload/route.ts tests/integration/upload-route.test.ts
git commit -m "feat: add ADMIN-gated /api/upload route with validation"
```

---

### Task 4: Make `menu.updateItem`'s `image` field nullable

**Files:**
- Modify: `src/server/trpc/routers/menu.ts:5-12` (the `menuItemInput` schema)

**Interfaces:**
- Produces: `menu.createItem`/`menu.updateItem` now accept `image?: string | null` instead of `image?: string`. Task 6's `admin/menu/page.tsx` wiring relies on being able to send `image: null` to clear a photo.

- [ ] **Step 1: Change the schema**

Current (`src/server/trpc/routers/menu.ts:5-12`):

```ts
const menuItemInput = z.object({
  name: z.string().min(1),
  price: z.number().positive(),
  categoryId: z.string(),
  available: z.boolean().default(true),
  image: z.string().optional(),
  modifiers: z.record(z.string(), z.any()).optional(),
});
```

Replace the `image` line so the block reads:

```ts
const menuItemInput = z.object({
  name: z.string().min(1),
  price: z.number().positive(),
  categoryId: z.string(),
  available: z.boolean().default(true),
  image: z.string().nullable().optional(),
  modifiers: z.record(z.string(), z.any()).optional(),
});
```

No other change is needed in this file: `createItem` and `updateItem` both spread the parsed input (`...input` / `...rest`) straight into Prisma's `data` object, and Prisma's `update` already treats an explicit `null` on a nullable scalar column as "set to NULL" and an `undefined` key as "leave unchanged" — the schema was the only thing forcing `image` to collapse through `undefined` before reaching Prisma.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds — `Prisma.MenuItemUncheckedUpdateInput`'s `image` field already accepts `string | null | undefined` for a nullable String column, so no cast is needed (unlike `modifiers`, which already has one for JSON-type reasons).

- [ ] **Step 3: Write a test proving a photo can be cleared**

Current full content of `tests/integration/menu-router.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db';
import { resetDb } from '../helpers/db';
import { appRouter } from '@/server/trpc/routers/_app';

describe('menu router', () => {
  beforeEach(resetDb);

  it('admin creates a category and item; public sees only available items', async () => {
    const admin = appRouter.createCaller({ db, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const anon = appRouter.createCaller({ db, user: null });

    const category = await admin.menu.createCategory({ name: 'Coffee', sortOrder: 1 });
    const item = await admin.menu.createItem({
      name: 'Latte', price: 4.5, categoryId: category.id, available: true,
    });
    await admin.menu.createItem({
      name: 'Hidden', price: 1, categoryId: category.id, available: false,
    });

    const available = await anon.menu.listAvailable();
    expect(available.map((i) => i.id)).toEqual([item.id]);
  });

  it('rejects createItem from a non-admin role', async () => {
    const cashier = appRouter.createCaller({ db, user: { userId: 'u2', role: 'STAFF', name: 'C' } });
    const category = await db.category.create({ data: { name: 'Tea', sortOrder: 2 } });
    await expect(
      cashier.menu.createItem({ name: 'Green Tea', price: 3, categoryId: category.id, available: true })
    ).rejects.toThrow();
  });
});
```

Add a new `it` block right before the final closing `});` (no new imports needed — `db`, `appRouter`, `expect`, `it` are all already imported), so the file's last two blocks read:

```ts
  it('rejects createItem from a non-admin role', async () => {
    const cashier = appRouter.createCaller({ db, user: { userId: 'u2', role: 'STAFF', name: 'C' } });
    const category = await db.category.create({ data: { name: 'Tea', sortOrder: 2 } });
    await expect(
      cashier.menu.createItem({ name: 'Green Tea', price: 3, categoryId: category.id, available: true })
    ).rejects.toThrow();
  });

  it('clears an item image by sending null', async () => {
    const admin = appRouter.createCaller({ db, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    const item = await db.menuItem.create({
      data: { name: 'Latte', price: 4.5, categoryId: category.id, image: 'http://example.com/old.jpg' },
    });

    const updated = await admin.menu.updateItem({ id: item.id, image: null });
    expect(updated.image).toBeNull();
  });
});
```

- [ ] **Step 4: Run the test**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" npx vitest run tests/integration/menu-router.test.ts`
Expected: all tests in the file pass, including the new one.

- [ ] **Step 5: Commit**

```bash
git add src/server/trpc/routers/menu.ts tests/integration/menu-router.test.ts
git commit -m "fix: allow menu item images to be cleared, not just replaced"
```

---

### Task 5: `src/components/ui/ImageUpload.tsx`

**Files:**
- Create: `src/components/ui/ImageUpload.tsx`

**Interfaces:**
- Consumes: `Button` from `./Button`, `MenuItemThumbnail` from `./MenuItemThumbnail` (already exist — `MenuItemThumbnail` takes `{ image, categoryName, alt, className }`).
- Produces: `ImageUpload({ value, onChange, categoryName }: { value: string | null; onChange: (url: string | null) => void; categoryName: string })`. Task 6 wires this into `admin/menu/page.tsx`.

- [ ] **Step 1: Create the component**

```tsx
// src/components/ui/ImageUpload.tsx
'use client';
import { useRef, useState } from 'react';
import { Button } from './Button';
import { MenuItemThumbnail } from './MenuItemThumbnail';

type ImageUploadProps = {
  value: string | null;
  onChange: (url: string | null) => void;
  categoryName: string;
};

export function ImageUpload({ value, onChange, categoryName }: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setError('');
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Upload failed');
        return;
      }
      onChange(data.url);
    } catch {
      setError('Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <MenuItemThumbnail
        image={value}
        categoryName={categoryName}
        alt="Item photo"
        className="w-16 h-16 rounded-xl shrink-0"
      />
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelected}
            className="hidden"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? 'Uploading…' : value ? 'Change Photo' : 'Upload Photo'}
          </Button>
          {value && (
            <Button variant="outline" size="sm" onClick={() => onChange(null)}>
              Remove
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-warning text-xs font-semibold">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/ImageUpload.tsx
git commit -m "feat: add ImageUpload component with preview and remove"
```

---

### Task 6: Wire `ImageUpload` into `admin/menu/page.tsx`

**Files:**
- Modify: `src/app/(staff)/admin/menu/page.tsx`

**Interfaces:**
- Consumes: `ImageUpload` from Task 5; `menu.updateItem`'s now-nullable `image` param from Task 4.

- [ ] **Step 1: Add the import**

Add after the existing `Select` import:

```tsx
import { ImageUpload } from '@/components/ui/ImageUpload';
```

- [ ] **Step 2: Change `image` state to `string | null` and drop the now-unused edit-image state**

Replace:

```tsx
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [image, setImage] = useState('');
```

with:

```tsx
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [image, setImage] = useState<string | null>(null);
```

Replace:

```tsx
  const createItem = trpc.menu.createItem.useMutation({
    onSuccess: () => { utils.menu.listAll.invalidate(); setName(''); setPrice(''); setImage(''); },
  });
```

with:

```tsx
  const createItem = trpc.menu.createItem.useMutation({
    onSuccess: () => { utils.menu.listAll.invalidate(); setName(''); setPrice(''); setImage(null); },
  });
```

Replace:

```tsx
  const [editingImageId, setEditingImageId] = useState<string | null>(null);
  const [editImageValue, setEditImageValue] = useState('');
  const updateImage = trpc.menu.updateItem.useMutation({
    onSuccess: () => { utils.menu.listAll.invalidate(); setEditingImageId(null); },
  });
```

with:

```tsx
  const [editingImageId, setEditingImageId] = useState<string | null>(null);
  const updateImage = trpc.menu.updateItem.useMutation({
    onSuccess: () => utils.menu.listAll.invalidate(),
  });
```

- [ ] **Step 3: Replace the New Item form's Image URL input**

Replace:

```tsx
          <Input
            value={image}
            onChange={(e) => setImage(e.target.value)}
            placeholder="Image URL (optional)"
            className="flex-1 min-w-[200px] px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <Button
            variant="dark"
            disabled={!name || !(Number(price) > 0) || !categoryId}
            onClick={() => createItem.mutate({ name, price: Number(price), categoryId, available: true, image: image || undefined })}
          >
            Add Item
          </Button>
        </div>
      </Card>
```

with:

```tsx
          <Button
            variant="dark"
            disabled={!name || !(Number(price) > 0) || !categoryId}
            onClick={() => createItem.mutate({ name, price: Number(price), categoryId, available: true, image: image ?? undefined })}
          >
            Add Item
          </Button>
        </div>
        <div className="mt-3">
          <ImageUpload
            value={image}
            onChange={setImage}
            categoryName={categories.find((c) => c.id === categoryId)?.name ?? ''}
          />
        </div>
      </Card>
```

(The `ImageUpload` moves below the button row rather than sitting inline between the price/category fields and the button — it's visually taller than a text input, so it gets its own row instead of squeezing into the `flex-wrap` row with everything else.)

- [ ] **Step 4: Replace the inline "Edit image" row**

Replace:

```tsx
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (editingImageId === item.id) {
                        setEditingImageId(null);
                      } else {
                        setEditingImageId(item.id);
                        setEditImageValue(item.image ?? '');
                      }
                    }}
                  >
                    {editingImageId === item.id ? 'Cancel' : 'Edit image'}
                  </Button>
```

with:

```tsx
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingImageId(editingImageId === item.id ? null : item.id)}
                  >
                    {editingImageId === item.id ? 'Cancel' : 'Edit image'}
                  </Button>
```

Then replace:

```tsx
              {editingImageId === item.id && (
                <div className="flex gap-2 pl-[52px]">
                  <Input
                    value={editImageValue}
                    onChange={(e) => setEditImageValue(e.target.value)}
                    placeholder="Image URL"
                    className="flex-1 min-w-[200px] px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => updateImage.mutate({ id: item.id, image: editImageValue || undefined })}
                  >
                    Save
                  </Button>
                </div>
              )}
```

with:

```tsx
              {editingImageId === item.id && (
                <div className="pl-[52px]">
                  <ImageUpload
                    value={item.image}
                    onChange={(url) => updateImage.mutate({ id: item.id, image: url })}
                    categoryName={item.category.name}
                  />
                </div>
              )}
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: succeeds. If `Input` is still used elsewhere in this file (it is — the `name` and `price` fields), its import stays; do not remove it.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(staff)/admin/menu/page.tsx"
git commit -m "feat: replace Image URL text field with file upload in admin menu"
```

---

### Task 7: End-to-end verification

**Files:** none (verification only)

**Interfaces:** none

- [ ] **Step 1: Run the full test suite**

Run (with MinIO running per Task 1):
```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" \
JWT_SECRET="dev-secret-change-in-prod" \
S3_ENDPOINT="http://localhost:9000" \
S3_ACCESS_KEY="minioadmin" \
S3_SECRET_KEY="minioadmin" \
S3_BUCKET="menu-images" \
S3_PUBLIC_URL="http://localhost:9000" \
npm test
```
Expected: all tests pass, including the new ones from Tasks 3 and 4.

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: succeeds cleanly.

- [ ] **Step 3: Manually verify the upload flow against a running dev server**

No browser automation is available in this session — use this project's established technique: start `npm run dev`, log in as ADMIN (PIN 1234 or the demo button), then drive the flow via real HTTP requests (Node `fetch` or `curl`) rather than a live browser:

1. `POST /api/trpc/auth.login` with `{"pin":"1234"}`, capturing the session cookie.
2. Build a real `multipart/form-data` request with a small real image file and `POST` it to `/api/upload` using the captured cookie — confirm a 200 response with a `url` field pointing at `http://localhost:9000/menu-images/<uuid>.<ext>`.
3. `fetch` that returned URL directly (no auth needed — the bucket is public-read) and confirm it returns the image bytes with a 200 status.
4. `POST /api/trpc/menu.createItem` with that URL as `image`, then `GET /api/trpc/menu.listAll` and confirm the created item's `image` field round-trips correctly.
5. Grep the rendered SSR HTML of `/admin/menu` (or fetch it while authenticated) for the item's `<img src="http://localhost:9000/menu-images/...">` tag to confirm `MenuItemThumbnail` is actually rendering the uploaded photo, not falling back to the category icon.

Expected: every step succeeds; the uploaded image is reachable and displayed.

- [ ] **Step 4: Clean up the test item created in Step 3**

The item created while verifying the flow in Step 3 must not remain in `pos_dev`. Delete it directly via a one-off script using the same `PrismaClient`/`PrismaPg` adapter pattern `prisma/seed.ts` already uses, pointed explicitly at `pos_dev`:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_dev" node -e "
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });
(async () => {
  await db.menuItem.deleteMany({ where: { name: { contains: 'verification', mode: 'insensitive' } } });
  await db.\$disconnect();
})();
"
```

Adjust the `name` filter to match whatever name was actually used for the test item created in Step 3 (this plan doesn't mandate a specific name for that item — pick one that's obviously a test artifact, e.g. \"Upload Verification Item\", when performing Step 3, so this filter can target it precisely).

Then re-verify counts are back to the expected seed baseline (23 menu items) via the same row-count check pattern used in this project's other plans:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_dev" node -e "
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });
(async () => {
  console.log(await db.menuItem.count());
  await db.\$disconnect();
})();
"
```
Expected: `23`.

---
