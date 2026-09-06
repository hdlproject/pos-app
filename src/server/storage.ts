import { S3Client, PutObjectCommand, GetObjectCommand, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

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

// The bucket is never made public -- every read goes through
// src/app/api/images/[key]/route.ts, which fetches the object with these
// same credentials and streams it back. That works identically whether the
// bucket is public or private, so there's no bucket-policy/ACL setup here,
// and no per-provider quirks to work around (some S3-compatible providers,
// e.g. Backblaze B2, don't support bucket policies at all).
function ensureBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = (async () => {
      try {
        await client.send(new HeadBucketCommand({ Bucket: BUCKET }));
      } catch {
        try {
          await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
        } catch (err) {
          // The bucket already existing is not a failure for our purposes —
          // only bail out (and let the outer .catch() clear bucketReady for
          // retry) on a genuinely unexpected error.
          const name = (err as { name?: string })?.name;
          if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') {
            throw err;
          }
        }
      }
    })().catch((err) => {
      // Don't permanently cache a rejected promise — a transient failure
      // here would otherwise poison every future upload until the process
      // restarts. Clear bucketReady so the next call retries from scratch.
      bucketReady = undefined;
      throw err;
    });
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
  return `/api/images/${key}`;
}

export async function getMenuImage(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const bytes = (await result.Body?.transformToByteArray()) ?? new Uint8Array();
    return { bytes, contentType: result.ContentType ?? 'application/octet-stream' };
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === 'NoSuchKey' || name === 'NotFound') return null;
    throw err;
  }
}
