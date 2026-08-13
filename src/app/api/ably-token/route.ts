import { createAblyTokenRequest } from '@/server/ably';
import { createContext } from '@/server/trpc/context';

export async function GET() {
  const { user } = await createContext();
  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }
  const tokenRequest = await createAblyTokenRequest(user.userId);
  return Response.json(tokenRequest);
}
