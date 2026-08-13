import Ably from 'ably';

let ablyRest: Ably.Rest | undefined;

function getAblyRest(): Ably.Rest {
  if (!ablyRest) {
    ablyRest = new Ably.Rest(process.env.ABLY_API_KEY!);
  }
  return ablyRest;
}

export async function createAblyTokenRequest(clientId: string) {
  return getAblyRest().auth.createTokenRequest({
    clientId,
    capability: { orders: ['subscribe'] },
  });
}

export async function publishOrderEvent(name: string, data: unknown): Promise<void> {
  const channel = getAblyRest().channels.get('orders');
  await channel.publish(name, data);
}
