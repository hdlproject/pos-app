import { describe, it, expect, vi } from 'vitest';

vi.mock('ably', () => {
  const publish = vi.fn();
  const channels = { get: vi.fn(() => ({ publish })) };
  const createTokenRequest = vi.fn(async () => ({ token: 'fake' }));
  return {
    default: { Rest: vi.fn(function () { return { channels, auth: { createTokenRequest } }; }) },
  };
});

import { publishOrderEvent, createAblyTokenRequest } from '@/server/ably';

describe('ably helper', () => {
  it('publishes to the orders channel', async () => {
    await expect(publishOrderEvent('order.created', { id: '1' })).resolves.toBeUndefined();
  });

  it('creates a token request for a client', async () => {
    const result = await createAblyTokenRequest('kds-client');
    expect(result).toEqual({ token: 'fake' });
  });
});
