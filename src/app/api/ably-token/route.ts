import { createAblyTokenRequest } from '@/server/ably';

export async function GET() {
  const tokenRequest = await createAblyTokenRequest('pos-client');
  return Response.json(tokenRequest);
}
