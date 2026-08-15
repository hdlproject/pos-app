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
  return `${process.env.S3_PUBLIC_URL}/${BUCKET}/${key}`;
}
