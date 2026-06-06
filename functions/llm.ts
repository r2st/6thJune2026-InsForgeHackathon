// functions/llm.ts
// Provider-agnostic LLM client for diagnose(). Returns an `AnthropicLike`
// (messages.create with forced-tool output) regardless of provider, so
// diagnose.ts stays provider-blind — it builds one Anthropic-style request and
// reads one tool_use block back.
//
// Switch providers with HUSH_LLM_PROVIDER (default: 'gemini'). Gemini is the
// default; Anthropic is one env flip away.
//
//   HUSH_LLM_PROVIDER=gemini      GEMINI_API_KEY=...   GEMINI_MODEL=gemini-2.5-flash
//   HUSH_LLM_PROVIDER=anthropic   ANTHROPIC_API_KEY=... ANTHROPIC_MODEL=claude-opus-4-8
//
// The Gemini path uses the Generative Language API's structured-output mode
// (responseMimeType: application/json + responseSchema) and translates the
// emit_diagnosis tool schema into Gemini's schema dialect. Errors carry the HTTP
// status so diagnose.ts's isTransient()/timeout handling behaves identically
// across providers.

import type { AnthropicLike } from './diagnose.js';

export type LlmProvider = 'gemini' | 'anthropic';

export function activeProvider(): LlmProvider {
  return (process.env.HUSH_LLM_PROVIDER ?? 'gemini').toLowerCase() === 'anthropic'
    ? 'anthropic'
    : 'gemini';
}

/** Resolve the provider client diagnose() drives. Default: Gemini. */
export async function createLlmClient(): Promise<AnthropicLike> {
  if (activeProvider() === 'anthropic') {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    return new Anthropic() as unknown as AnthropicLike;
  }
  return geminiClient();
}

// ── Anthropic-style request shape diagnose() builds (the subset we read) ──────

interface ToolDef { name: string; description?: string; input_schema: unknown }
interface AnthropicBody {
  model?: string;
  max_tokens?: number;
  system?: string;
  messages: { role: string; content: string }[];
  tools?: ToolDef[];
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function statusError(status: number, message: string): Error {
  const e = new Error(message) as Error & { status: number };
  e.status = status;
  return e;
}

/** A Gemini-backed AnthropicLike. Translates one forced-tool call each way. */
export function geminiClient(): AnthropicLike {
  return {
    messages: {
      async create(body: unknown, opts?: { signal?: AbortSignal }) {
        const b = body as AnthropicBody;
        const key = process.env.GEMINI_API_KEY;
        if (!key) throw statusError(401, 'llm(gemini): GEMINI_API_KEY not set');
        const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
        const tool = b.tools?.[0];

        const userText = b.messages
          .filter((m) => m.role === 'user')
          .map((m) => m.content)
          .join('\n\n');

        const req = {
          ...(b.system ? { systemInstruction: { parts: [{ text: b.system }] } } : {}),
          contents: [{ role: 'user', parts: [{ text: userText }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            ...(tool ? { responseSchema: toGeminiSchema(tool.input_schema) } : {}),
            maxOutputTokens: b.max_tokens ?? 2048,
            temperature: 0,
          },
        };

        const res = await fetch(`${GEMINI_BASE}/${model}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify(req),
          ...(opts?.signal ? { signal: opts.signal } : {}),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw statusError(res.status, `llm(gemini): ${res.status} ${text.slice(0, 300)}`);
        }

        const data = (await res.json()) as GeminiResponse;
        const cand = data.candidates?.[0];

        // Map Gemini finish reasons onto the stop_reason diagnose() routes on.
        if (cand?.finishReason === 'MAX_TOKENS') {
          return { content: [], stop_reason: 'max_tokens' };
        }

        const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('');
        let input: unknown;
        try {
          input = JSON.parse(text);
        } catch {
          // A non-JSON body from a json-mode call is a provider fault — make it
          // transient (5xx) so the retry/timeout budget handles it.
          throw statusError(502, 'llm(gemini): response was not valid JSON');
        }

        return {
          content: [{ type: 'tool_use', name: tool?.name ?? 'emit_diagnosis', input }],
          stop_reason: 'tool_use',
        };
      },
    },
  };
}

interface GeminiResponse {
  candidates?: {
    finishReason?: string;
    content?: { parts?: { text?: string }[] };
  }[];
}

/**
 * Translate a JSON-Schema (the emit_diagnosis tool schema) into Gemini's schema
 * dialect: keep only the keywords Gemini's responseSchema understands and drop
 * the rest (notably `additionalProperties`, `$schema`, `$id`), recursively.
 */
export function toGeminiSchema(schema: unknown): unknown {
  if (schema === null || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);

  const ALLOW = new Set([
    'type', 'format', 'description', 'nullable', 'enum',
    'items', 'properties', 'required', 'minItems', 'maxItems', 'propertyOrdering',
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (!ALLOW.has(k)) continue;
    if (k === 'properties' && v && typeof v === 'object') {
      const props: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) {
        props[pk] = toGeminiSchema(pv);
      }
      out.properties = props;
    } else if (k === 'items') {
      out.items = toGeminiSchema(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
