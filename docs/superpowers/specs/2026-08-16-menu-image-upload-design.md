# Menu Item Image Upload (Local S3/MinIO) — Design

**Date**: 2026-08-16
**Status**: Approved (design), pending implementation plan

## Overview

Replace the admin menu page's "Image URL" text field — in both the "New Item" creation form and the per-item inline "Edit image" flow — with a real file-upload control. Uploaded photos are stored in a local S3-compatible object store (MinIO), run via `docker-compose` alongside this project's existing Postgres and Redis containers. `MenuItem.image` stays a `String?` URL column (no schema change) — the upload flow's only job is to turn a selected file into a URL to store there, exactly as the text field did before.

## Scope

**In scope:**
- Add a `minio` service to `docker-compose.yml`.
- `src/server/storage.ts`: S3 client wrapper (`@aws-sdk/client-s3`), idempotent bucket/policy setup, `uploadMenuImage()`.
- `src/app/api/upload/route.ts`: authenticated (ADMIN-only), validated (image mime type, 5MB cap) upload endpoint.
- `src/components/ui/ImageUpload.tsx`: file-picker UI with preview, replacing the "Image URL" `Input` everywhere it appears.
- Wire `ImageUpload` into `admin/menu/page.tsx`'s New Item form and inline Edit-image row.
- Properly support *clearing* an item's image (a real gap in the current text-field flow — sending an empty string collapses to `undefined`, which Prisma treats as "leave unchanged," so a bad image can't actually be removed today). Fixed as part of this rebuild since it's the same code path.
- New env vars: `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_PUBLIC_URL`.
- One integration test for the upload route (auth gate + validation), matching this project's convention of testing real server logic, not presentational UI.

**Out of scope:**
- Presigned-URL direct-to-MinIO upload (proxy-through-Next.js chosen instead — see design doc history in conversation).
- Any change to `MenuItem.image`'s underlying storage shape (still a plain URL string).
- Image resizing/thumbnailing/optimization — the uploaded file is stored and served as-is.
- Uploading images anywhere other than the admin menu page (no bulk upload, no drag-and-drop reordering, etc.).

## Infrastructure

`docker-compose.yml` gains:

```yaml
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
```

Add `pos_minio_data:` to the `volumes:` block. Same unauthenticated-for-local-dev posture as the existing `postgres`/`redis` services (root credentials in plain env vars, no TLS) — consistent with this project's local-only setup, not a production deployment concern.

Port 9000 is the S3 API; port 9001 is MinIO's web console (useful for inspecting uploaded files during development, not required by the app itself).

## Backend

**New dependency:** `@aws-sdk/client-s3` (latest major version) — the standard AWS SDK v3 S3 client, which MinIO's S3-compatible API works with directly by pointing `endpoint` at MinIO instead of AWS.

**Env vars** (added to `.env` / `.env.example`):
- `S3_ENDPOINT=http://localhost:9000`
- `S3_ACCESS_KEY=minioadmin`
- `S3_SECRET_KEY=minioadmin`
- `S3_BUCKET=menu-images`
- `S3_PUBLIC_URL=http://localhost:9000` — base URL used to construct the URL stored in `MenuItem.image`; for local dev this is the same host:port the browser itself can reach, since MinIO's port is mapped straight to the host.

**`src/server/storage.ts`:**
```ts
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

`ensureBucket()` memoizes its promise on the module-level `bucketReady` so concurrent requests during cold start don't race to create the bucket twice; a `HeadBucketCommand` success short-circuits on every call after the first.

**`src/app/api/upload/route.ts`:**
```ts
import { createContext } from '@/server/trpc/context';
import { uploadMenuImage } from '@/server/storage';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export async function POST(request: Request) {
  const { user } = await createContext();
  if (!user) return new Response('Unauthorized', { status: 401 });
  if (user.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });

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

This mirrors `src/app/api/ably-token/route.ts`'s existing pattern of calling `createContext()` directly in a route handler for auth (already established in this codebase), extended with a role check since this endpoint additionally requires ADMIN, not just any authenticated user.

**Clearing an image (fixing the existing gap):** `menu.updateItem`'s Zod schema in `src/server/trpc/routers/menu.ts` changes `image: z.string().optional()` to `image: z.string().nullable().optional()`, and its Prisma update-data mapping passes `image` through as-is (including explicit `null`) rather than coercing falsy values to `undefined`. This lets the frontend send `image: null` to genuinely clear the field, distinct from omitting `image` entirely (leave unchanged) — Prisma's `update` already treats `null` vs "key absent" correctly once the Zod schema stops collapsing them.

## Frontend

**`src/components/ui/ImageUpload.tsx`:**
```tsx
type ImageUploadProps = {
  value: string | null;
  onChange: (url: string | null) => void;
  categoryName: string;
};
```
- Renders `MenuItemThumbnail` (existing component) sized `w-16 h-16 rounded-xl` as a live preview of the current `value` (or the category icon fallback if none).
- A hidden `<input type="file" accept="image/*">` behind a `Button` labeled "Change Photo" (if `value` is set) or "Upload Photo" (if not).
- On file selection: immediately `POST`s to `/api/upload` as `multipart/form-data`, shows an "Uploading…" state on the button, and on success calls `onChange(url)`. On failure, shows the server's error message inline (same red warning-text style used elsewhere in this app, e.g. `src/app/login/page.tsx`'s invalid-PIN message) and leaves `value` unchanged.
- If `value` is set, a small "Remove" text button beside it calls `onChange(null)`.

**Wiring into `admin/menu/page.tsx`:**
- New Item form: replace the "Image URL (optional)" `Input` with `<ImageUpload value={image} onChange={setImage} categoryName={categories.find((c) => c.id === categoryId)?.name ?? ''} />` (the `image` state changes type from `string` to `string | null`, defaulting to `null`; `createItem.mutate` already accepts `image: image ?? undefined` for the create case — a brand-new item has no image to "clear," so `null` and "omit" are equivalent there and either works, but `undefined` is passed to match the create endpoint's existing `image?: string` shape without needing the nullable change on create).
- Inline "Edit image" row: replace the `Input` + "Save" button pair with `<ImageUpload value={editImageValue} onChange={(url) => updateImage.mutate({ id: item.id, image: url })} categoryName={item.category.name} />` — since `ImageUpload` now uploads and reports the final URL (or `null` for a removal) directly, there's no separate "Save" step needed; selecting a file or clicking Remove immediately persists via the mutation. The existing "Edit image" / "Cancel" toggle button that reveals this row stays as-is.

## Error Handling

- Upload route: 401 (not logged in), 403 (not ADMIN), 400 with a specific message (no file / wrong type / too large). All four are realistic during normal admin use (session expiry, non-admin staff somehow reaching the page, picking the wrong file) — the frontend renders whichever message comes back.
- MinIO unreachable (container not running): `S3Client` calls throw; the route handler doesn't currently rescue that case specially, and it'll surface as a 500 with the AWS SDK's connection-refused error — acceptable for a local dev tool where "the container isn't running" is a self-evident, self-fixable state (matches how this project already treats missing Postgres/Redis containers — no special-cased health-check UI exists for those either).

## Testing

- New integration test file `tests/integration/upload-route.test.ts` (or added to an existing suitable file): POST a small valid PNG buffer as an authenticated ADMIN → expect 200 and a `url` field; POST as an authenticated STAFF/KITCHEN user → expect 403; POST unauthenticated → expect 401; POST a >5MB buffer → expect 400; POST a non-image content type → expect 400. Requires MinIO reachable in the test environment — same `docker-compose` stack the existing Postgres-backed integration tests already depend on, so no new test-infra concept, just one more container that needs to be running for `npm test` (documented in the plan's testing instructions).
- No automated test for `ImageUpload` itself (pure UI, matches this project's established convention for presentational components).
