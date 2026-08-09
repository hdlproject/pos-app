import Ably from 'ably';

const ablyRest = new Ably.Rest(process.env.ABLY_API_KEY!);

export async function createAblyTokenRequest(clientId: string) {
  return ablyRest.auth.createTokenRequest({ clientId });
}

export async function publishOrderEvent(name: string, data: unknown): Promise<void> {
  const channel = ablyRest.channels.get('orders');
  await channel.publish(name, data);
}
