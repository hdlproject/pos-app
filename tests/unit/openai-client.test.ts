import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchChatCompletion } from '@/server/ai/openaiClient';

describe('fetchChatCompletion', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_MODEL;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_MODEL = 'test-model';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalKey;
    process.env.OPENAI_MODEL = originalModel;
    vi.restoreAllMocks();
  });

  it('posts the messages to the chat completions endpoint and returns the content', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('test-model');
      expect(body.messages).toEqual([{ role: 'system', content: 'sys' }]);
      expect(body.response_format).toEqual({ type: 'json_object' });
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '{"suggestions":[]}' } }] }),
      } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchChatCompletion([{ role: 'system', content: 'sys' }]);
    expect(result).toBe('{"suggestions":[]}');
  });

  it('throws when the response is not ok', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500 }) as Response) as unknown as typeof fetch;
    await expect(fetchChatCompletion([{ role: 'system', content: 'sys' }])).rejects.toThrow();
  });

  it('throws when the response has no message content', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [] }),
    }) as Response) as unknown as typeof fetch;
    await expect(fetchChatCompletion([{ role: 'system', content: 'sys' }])).rejects.toThrow();
  });
});
