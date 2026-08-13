import { cookies } from 'next/headers';
import { createAblyTokenRequest } from '@/server/ably';
import { verifySession } from '@/server/auth/session';

export async function GET() {
  const token = (await cookies()).get('session')?.value;
  const user = token ? await verifySession(token) : null;
  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }
  const tokenRequest = await createAblyTokenRequest(user.userId);
  return Response.json(tokenRequest);
}
