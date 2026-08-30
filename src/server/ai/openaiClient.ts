import type { SuggestionMessage } from './suggestion';

export async function fetchChatCompletion(
  messages: SuggestionMessage[],
  options?: { maxTokens?: number }
): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL,
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: options?.maxTokens ?? 400,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    throw new Error(`OpenAI request failed with status ${res.status}`);
  }

  let data: { choices?: { message?: { content?: string } }[] };
  try {
    data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  } catch {
    throw new Error('OpenAI response was not valid JSON');
  }
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('OpenAI response missing message content');
  }
  return content;
}
