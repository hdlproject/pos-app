import { getMenuImage } from '@/server/storage';

export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const image = await getMenuImage(key);
  if (!image) return new Response('Not found', { status: 404 });

  return new Response(Buffer.from(image.bytes), {
    headers: {
      'Content-Type': image.contentType,
      // The key is a random UUID minted once per upload and never reused,
      // so a cached response is never stale -- safe to cache forever.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
