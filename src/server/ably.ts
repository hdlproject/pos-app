import { BaseRest, FetchRequest } from 'ably/modular';

// The default `ably` import always bundles MessagePack support
// (@ably/msgpack-js -> bops), which calls `new Function(...)` at module
// load time -- disallowed in Cloudflare Workers ("EvalError: Code
// generation from strings disallowed"), and it crashed silently enough
// that every tRPC request appeared to succeed while the actual handler
// never ran. The modular API lets us build a REST client with only the
// plugins we ask for; omitting the MsgPack plugin means Ably falls back
// to JSON (which is all we ever needed) and none of that code is bundled.
let ablyRest: BaseRest | undefined;

function getAblyRest(): BaseRest {
  if (!ablyRest) {
    ablyRest = new BaseRest({ key: process.env.ABLY_API_KEY!, plugins: { FetchRequest } });
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
