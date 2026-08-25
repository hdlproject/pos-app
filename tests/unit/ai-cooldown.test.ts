import { describe, it, expect, beforeEach } from 'vitest';
import { redis } from '@/server/redis';
import { checkAndSetCooldown, clearCooldown } from '@/server/ai/cooldown';

describe('checkAndSetCooldown', () => {
  beforeEach(async () => {
    await redis.flushdb();
  });

  it('allows the first request for a table token', async () => {
    await expect(checkAndSetCooldown('table-a')).resolves.toBe(true);
  });

  it('blocks a second request for the same table token within the cooldown window', async () => {
    await checkAndSetCooldown('table-a');
    await expect(checkAndSetCooldown('table-a')).resolves.toBe(false);
  });

  it('tracks cooldowns independently per table token', async () => {
    await checkAndSetCooldown('table-a');
    await expect(checkAndSetCooldown('table-b')).resolves.toBe(true);
  });

  it('releases the cooldown so a subsequent request is allowed again', async () => {
    await checkAndSetCooldown('table-x');
    await clearCooldown('table-x');
    await expect(checkAndSetCooldown('table-x')).resolves.toBe(true);
  });
});
