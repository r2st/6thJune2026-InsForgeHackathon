// functions/llm.test.ts
// Provider abstraction (Gemini default, Anthropic switchable) — ticket 0047.
//
// Run: pnpm -F @hush/functions test

import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeProvider, geminiClient, toGeminiSchema } from './llm.js';

const ORIG = { ...process.env };
afterEach(() => {
  process.env = { ...ORIG };
  vi.restoreAllMocks();
});

describe('activeProvider — Gemini is the default, Anthropic is one flip away', () => {
  it('defaults to gemini when unset', () => {
    delete process.env.HUSH_LLM_PROVIDER;
    expect(activeProvider()).toBe('gemini');
  });
  it('respects an explicit anthropic selection (case-insensitive)', () => {
    process.env.HUSH_LLM_PROVIDER = 'Anthropic';
    expect(activeProvider()).toBe('anthropic');
  });
  it('anything else falls back to gemini', () => {
    process.env.HUSH_LLM_PROVIDER = 'whatever';
    expect(activeProvider()).toBe('gemini');
  });
});

describe('toGeminiSchema — strip JSON-Schema keywords Gemini rejects', () => {
  it('drops additionalProperties / $schema, keeps type/properties/required recursively', () => {
    const out = toGeminiSchema({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      required: ['summary'],
      properties: {
        summary: { type: 'string', description: 'plain english' },
        tomlDiff: {
          type: 'object',
          additionalProperties: false,
          properties: { before: { type: 'string' }, after: { type: 'string' } },
        },
        tags: { type: 'array', items: { type: 'string', additionalProperties: false } },
      },
    }) as Record<string, any>;
    expect(out.$schema).toBeUndefined();
    expect(out.additionalProperties).toBeUndefined();
    expect(out.type).toBe('object');
    expect(out.required).toEqual(['summary']);
    expect(out.properties.summary).toEqual({ type: 'string', description: 'plain english' });
    expect(out.properties.tomlDiff.additionalProperties).toBeUndefined();
    expect(out.properties.tomlDiff.properties.after).toEqual({ type: 'string' });
    expect(out.properties.tags.items).toEqual({ type: 'string' });
  });
});

describe('geminiClient.messages.create — Anthropic-shaped in, tool_use out', () => {
  const body = {
    model: 'ignored-by-gemini',
    max_tokens: 1024,
    system: 'You are Hush.',
    messages: [{ role: 'user', content: 'Diagnose the empty orders page.' }],
    tools: [{ name: 'emit_diagnosis', input_schema: { type: 'object', additionalProperties: false, properties: { summary: { type: 'string' } } } }],
  };

  function mockFetch(status: number, json: unknown) {
    return vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
      text: async () => JSON.stringify(json),
    })) as unknown as typeof fetch;
  }

  it('translates a JSON-mode response into a tool_use block', async () => {
    process.env.GEMINI_API_KEY = 'AQ.test';
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    const fetchMock = mockFetch(200, {
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"summary":"RLS reads stale tenant claim"}' }] } }],
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await geminiClient().messages.create(body);
    expect(res.stop_reason).toBe('tool_use');
    expect(res.content[0]).toEqual({ type: 'tool_use', name: 'emit_diagnosis', input: { summary: 'RLS reads stale tenant claim' } });

    // It POSTed structured-output config + the sanitised schema + the key header.
    const [url, init] = (fetchMock as any).mock.calls[0];
    expect(String(url)).toContain('gemini-2.5-flash:generateContent');
    expect((init.headers)['x-goog-api-key']).toBe('AQ.test');
    const sent = JSON.parse(init.body);
    expect(sent.generationConfig.responseMimeType).toBe('application/json');
    expect(sent.generationConfig.responseSchema.additionalProperties).toBeUndefined();
    expect(sent.systemInstruction.parts[0].text).toBe('You are Hush.');
    expect(sent.contents[0].parts[0].text).toContain('Diagnose the empty orders page.');
  });

  it('MAX_TOKENS finish → stop_reason max_tokens (diagnose routes it as truncated)', async () => {
    process.env.GEMINI_API_KEY = 'AQ.test';
    vi.stubGlobal('fetch', mockFetch(200, { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] }));
    const res = await geminiClient().messages.create(body);
    expect(res.stop_reason).toBe('max_tokens');
  });

  it('HTTP error carries .status so isTransient classifies it (429 transient)', async () => {
    process.env.GEMINI_API_KEY = 'AQ.test';
    vi.stubGlobal('fetch', mockFetch(429, { error: 'rate limited' }));
    await expect(geminiClient().messages.create(body)).rejects.toMatchObject({ status: 429 });
  });

  it('missing key → 401 (non-transient, surfaces clearly)', async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(geminiClient().messages.create(body)).rejects.toMatchObject({ status: 401 });
  });

  it('non-JSON body from json-mode → 502 (transient provider fault)', async () => {
    process.env.GEMINI_API_KEY = 'AQ.test';
    vi.stubGlobal('fetch', mockFetch(200, { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'not json' }] } }] }));
    await expect(geminiClient().messages.create(body)).rejects.toMatchObject({ status: 502 });
  });
});
