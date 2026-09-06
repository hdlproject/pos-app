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

import {
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketPolicyCommand,
  PutBucketAclCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { uploadMenuImage } from '@/server/storage';

describe('uploadMenuImage bucket public-read fallback', () => {
  it('falls back to PutBucketAcl when the provider rejects PutBucketPolicy (e.g. Backblaze B2)', async () => {
    sendMock.mockImplementation(async (command: unknown) => {
      if (command instanceof HeadBucketCommand) throw new Error('bucket does not exist');
      if (command instanceof CreateBucketCommand) return {};
      if (command instanceof PutBucketPolicyCommand) throw new Error('NotImplemented');
      if (command instanceof PutBucketAclCommand) return {};
      if (command instanceof PutObjectCommand) return {};
      throw new Error(`unexpected command sent: ${(command as { constructor: { name: string } }).constructor.name}`);
    });

    const url = await uploadMenuImage(Buffer.from('fake image bytes'), 'photo.png', 'image/png');

    expect(url).toMatch(/\.png$/);
    const aclCalls = sendMock.mock.calls.filter(([cmd]) => cmd instanceof PutBucketAclCommand);
    expect(aclCalls).toHaveLength(1);
    expect((aclCalls[0][0] as PutBucketAclCommand).input).toMatchObject({ ACL: 'public-read' });
  });
});
