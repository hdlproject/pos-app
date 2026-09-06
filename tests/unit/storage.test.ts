import { describe, it, expect, vi } from 'vitest';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock('@aws-sdk/client-s3', async () => {
  const actual = await vi.importActual<typeof import('@aws-sdk/client-s3')>('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: vi.fn().mockImplementation(function S3Client() {
      return { send: sendMock };
    }),
  };
});

import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getMenuImage } from '@/server/storage';

describe('getMenuImage', () => {
  it('returns null instead of throwing when the object does not exist', async () => {
    sendMock.mockImplementation(async (command: unknown) => {
      if (command instanceof GetObjectCommand) {
        const err = new Error('not found');
        err.name = 'NoSuchKey';
        throw err;
      }
      throw new Error('unexpected command');
    });

    await expect(getMenuImage('missing.png')).resolves.toBeNull();
  });
});
