import { redis } from '../redis';

const COOLDOWN_SECONDS = 30;

export async function checkAndSetCooldown(tableToken: string): Promise<boolean> {
  const key = `ai-suggest-cooldown:${tableToken}`;
  const result = await redis.set(key, '1', 'EX', COOLDOWN_SECONDS, 'NX');
  return result === 'OK';
}
