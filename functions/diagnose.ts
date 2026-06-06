// functions/diagnose.ts
// Anthropic API call: produces a structured Diagnosis from a session +
// request log + TOML slice.
//
// Ticket: agents/tasks/0018-diagnose-output-schema-and-prompt.md
// Prompt: prompts/diagnose.v1.md   (the system prompt + user template)
// Schema: schemas/diagnosis.schema.json (the wire contract)
// ADR:    docs/decisions/0002-diagnose-output-contract.md
//
// We call Claude directly via the official SDK (ANTHROPIC_API_KEY), not the
// InsForge AI / OpenRouter gateway — the diagnosis is the one step where model
// quality is load-bearing for the demo, and a forced tool call gives us
// schema-shaped output with no prose-to-JSON parsing. The model fills every
// field except promptVersion, which we stamp from the prompt header so a run
// can never lie about which prompt produced it.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// The SDK is loaded dynamically inside diagnose() (the only code path that needs
// it) via the injectable createClient seam, so the pure-helper and resilience
// unit tests never resolve @anthropic-ai/sdk. We model the slice we depend on as
// AnthropicLike below rather than import the SDK's types.

import type { CapturedSession, RequestLogEntry, Diagnosis, SanitisedContext } from './types.js';
import { validate, type JsonSchema } from './lib/validateSchema.js';
import { renderUserDataBlock } from './sanitise.js';

const MODEL = 'claude-opus-4-8';

export interface DiagnoseInput {
  session: CapturedSession;
  failingRequest: RequestLogEntry;
  expectedRows: number;
  /** Output of toml.extractTomlContext() — the implicated table's slice. */
  tomlContext: string;
  /**
   * The JWT claims carried by the failing request, if captured. The prompt
   * grounds the fix on these; absent, we tell the model so it won't invent a
   * claim shape (hard rule 4 in the prompt).
   */
  jwtClaims?: Record<string, unknown>;
  /**
   * Ticket 0031. When present, diagnose() switches to the v2 prompt and embeds
   * user-controlled content in a walled, pre-stripped <user-data> block. Built
   * by sanitiseCaptureContent(). Absent → v1 (schema-grounded, no untrusted
   * content) — the default for the demo.
   */
  sanitised?: SanitisedContext;
}

// ── Prompt + schema loading ──────────────────────────────────────────────────
// Read both as files so prompts/diagnose.v1.md and schemas/diagnosis.schema.json
// stay the single source of truth (functions/README.md house rule: prompt and
// schema versions move together). Loaded once at module init.

const PROMPT_PATH = fileURLToPath(new URL('./prompts/diagnose.v1.md', import.meta.url));
const PROMPT_V2_PATH = fileURLToPath(new URL('./prompts/diagnose.v2.md', import.meta.url));
const SCHEMA_PATH = fileURLToPath(new URL('./schemas/diagnosis.schema.json', import.meta.url));

interface PromptParts {
  promptVersion: string;
  system: string;
  userTemplate: string;
}

/** Split the prompt markdown into its versioned header, system text, and the
 *  fenced user template. Exported for the prompt-shape test. */
export function parsePrompt(raw: string): PromptParts {
  const versionMatch = raw.match(/PROMPT_VERSION:\s*(diagnose-v[0-9]+\.[0-9]+\.[0-9]+)/);
  if (!versionMatch) throw new Error('diagnose.v1.md: missing PROMPT_VERSION header');

  // System prompt: everything under "# System" up to the next top-level "# ".
  const systemMatch = raw.match(/^# System\s*\n([\s\S]*?)(?=^# )/m);
  if (!systemMatch) throw new Error('diagnose.v1.md: missing "# System" section');

  // User template: the first fenced block after "# User template".
  const userMatch = raw.match(/^# User template[^\n]*\n+```\n([\s\S]*?)```/m);
  if (!userMatch) throw new Error('diagnose.v1.md: missing user-template fenced block');

  return {
    promptVersion: versionMatch[1]!,
    system: systemMatch[1]!.trim(),
    userTemplate: userMatch[1]!.trim(),
  };
}

let _prompt: PromptParts | null = null;
function getPrompt(): PromptParts {
  return (_prompt ??= parsePrompt(readFileSync(PROMPT_PATH, 'utf8')));
}

let _promptV2: PromptParts | null = null;
function getPromptV2(): PromptParts {
  return (_promptV2 ??= parsePrompt(readFileSync(PROMPT_V2_PATH, 'utf8')));
}

/** Pick the prompt: v2 when sanitised untrusted content is present, else v1. */
function promptFor(input: DiagnoseInput): PromptParts {
  return input.sanitised ? getPromptV2() : getPrompt();
}

let _schema: JsonSchema | null = null;
function getSchema(): JsonSchema {
  return (_schema ??= JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as JsonSchema);
}

/** PROMPT_VERSION from the prompt header — the value stamped onto every run. */
export function promptVersion(): string {
  return getPrompt().promptVersion;
}

// ── Template filling ──────────────────────────────────────────────────────────

/** Replace every {{key}} with vars[key]; throws if a placeholder is unfilled
 *  so a renamed template field fails loudly instead of leaking "{{x}}". */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const v = vars[key];
    if (v === undefined) throw new Error(`diagnose template: no value for {{${key}}}`);
    return v;
  });
}

/** Build the user message from a DiagnoseInput. Exported for tests. */
export function buildUserMessage(input: DiagnoseInput): string {
  const { session, failingRequest, expectedRows, tomlContext, jwtClaims, sanitised } = input;
  const common: Record<string, string> = {
    sessionId: session.sessionId,
    tenantId: session.tenantId,
    frustrationAt: session.frustrationAt ?? '(none)',
    expectedRows: String(expectedRows),
    method: failingRequest.method,
    path: failingRequest.route,
    jwtClaims: jwtClaims ? JSON.stringify(jwtClaims) : '(not captured)',
    rlsDecisions: JSON.stringify(failingRequest.rlsDecisions ?? []),
    returnedRows: String(failingRequest.returnedRows ?? 0),
    tomlContext: tomlContext.trim() || '(empty)',
  };
  // v2 wires the walled user-data block + injection flag; v1 keeps userId.
  if (sanitised) {
    return fillTemplate(getPromptV2().userTemplate, {
      ...common,
      userData: renderUserDataBlock(sanitised),
      promptInjectionSuspected: String(sanitised.sanitisedFlags.promptInjectionSuspected),
    });
  }
  return fillTemplate(getPrompt().userTemplate, { ...common, userId: session.userId });
}

// ── Tool schema ────────────────────────────────────────────────────────────────

/** Derive the emit_diagnosis tool input schema from the wire contract by
 *  dropping promptVersion — the model never emits it; we stamp it. Exported so
 *  the test can prove the model isn't asked for it. */
export function buildToolInputSchema(schema: JsonSchema): JsonSchema {
  const props = { ...(schema.properties ?? {}) };
  delete props.promptVersion;
  return {
    type: 'object',
    additionalProperties: false,
    required: (schema.required ?? []).filter((k) => k !== 'promptVersion'),
    properties: props,
  };
}

// ── Resilience (ticket 0036) ─────────────────────────────────────────────────
// diagnose sits on the critical path with a ~6s budget (ADR 0001). A slow,
// rate-limited, or overloaded Claude must not freeze the receipt mid-pitch. We
// enforce a hard wall-clock timeout, retry transient failures with bounded
// backoff inside that budget, and surface a discriminable DiagnoseError the
// orchestrator routes on — degrade visibly, never hang.

export type DiagnoseFailureReason = 'timeout' | 'unavailable' | 'truncated' | 'bad_request';

export class DiagnoseError extends Error {
  constructor(public readonly reason: DiagnoseFailureReason, message: string) {
    super(message);
    this.name = 'DiagnoseError';
  }
}

/** Minimal shape of the Anthropic client we depend on — keeps tests SDK-free. */
export interface AnthropicLike {
  messages: { create(body: unknown, opts?: { signal?: AbortSignal }): Promise<AnthropicResponse> };
}
interface AnthropicResponse {
  content: { type: string; name?: string; input?: unknown }[];
  stop_reason: string | null;
}

export interface DiagnoseOptions {
  /** Hard wall-clock ceiling. Default 12s (env HUSH_DIAGNOSE_TIMEOUT_MS), under the 45s envelope. */
  timeoutMs?: number;
  /** Transient-error retries inside the timeout budget. Default 2. */
  maxRetries?: number;
  /** Injectable backoff sleep (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable client factory — defaults to the lazily-imported real SDK. */
  createClient?: () => Promise<AnthropicLike>;
}

const TIMEOUT = Symbol('diagnose-timeout');

async function defaultCreateClient(): Promise<AnthropicLike> {
  // Provider-agnostic: HUSH_LLM_PROVIDER selects Gemini (default) or Anthropic.
  // Lazy import keeps pure-helper tests SDK-free and only loads the chosen path.
  const { createLlmClient } = await import('./llm.js');
  return createLlmClient();
}

/** 429/500/529 and connection errors are transient; 400/401 are not. */
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isTransient(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === undefined) return true; // network / connection drop
  if (status === 400 || status === 401 || status === 403 || status === 422) return false;
  return status === 429 || status >= 500;
}

// ── The call ────────────────────────────────────────────────────────────────────

export async function diagnose(input: DiagnoseInput, opts: DiagnoseOptions = {}): Promise<Diagnosis> {
  const prompt = promptFor(input);
  const { system } = prompt;
  const schema = getSchema();

  const timeoutMs = opts.timeoutMs ?? Number(process.env.HUSH_DIAGNOSE_TIMEOUT_MS ?? 12_000);
  const maxRetries = opts.maxRetries ?? 2;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const client = await (opts.createClient ?? defaultCreateClient)();

  const body = {
    model: MODEL,
    max_tokens: 2048,
    system,
    messages: [{ role: 'user', content: buildUserMessage(input) }],
    tools: [
      {
        name: 'emit_diagnosis',
        description:
          'Emit the structured diagnosis. This is the only output downstream ' +
          'steps consume — do not write prose.',
        input_schema: buildToolInputSchema(schema),
      },
    ],
    // Force the tool so the response is schema-shaped, never prose.
    tool_choice: { type: 'tool', name: 'emit_diagnosis' },
  };

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(TIMEOUT); }, timeoutMs);
  });

  let response: AnthropicResponse;
  try {
    // Retry transient failures with bounded exponential backoff; race the whole
    // thing against the hard timeout so a hang can never outlive the budget.
    const attempt = async (): Promise<AnthropicResponse> => {
      for (let i = 0; ; i++) {
        try {
          return await client.messages.create(body, { signal: controller.signal });
        } catch (err) {
          if (controller.signal.aborted) throw err;
          if (i >= maxRetries || !isTransient(err)) throw err;
          await sleep(250 * 2 ** i); // 250ms, 500ms
        }
      }
    };
    response = await Promise.race([attempt(), timeout]);
  } catch (err) {
    if (err === TIMEOUT || controller.signal.aborted) {
      throw new DiagnoseError('timeout', `diagnose: timed out after ${timeoutMs}ms`);
    }
    if (!isTransient(err)) {
      throw new DiagnoseError('bad_request', `diagnose: non-retryable API error — ${errMsg(err)}`);
    }
    throw new DiagnoseError('unavailable', `diagnose: API unavailable after ${maxRetries} retries — ${errMsg(err)}`);
  } finally {
    if (timer) clearTimeout(timer);
  }

  // A max_tokens stop means the tool args may be partial — never validate-then-throw
  // on a truncated body; treat it as a diagnose failure the orchestrator can route.
  if (response.stop_reason === 'max_tokens') {
    throw new DiagnoseError('truncated', 'diagnose: response truncated (stop_reason=max_tokens)');
  }

  const toolUse = response.content.find(
    (block) => block.type === 'tool_use' && block.name === 'emit_diagnosis',
  );
  if (!toolUse) {
    throw new DiagnoseError(
      'unavailable',
      `diagnose: model did not call emit_diagnosis (stop_reason=${response.stop_reason})`,
    );
  }

  // Stamp the prompt version ourselves, then validate the whole thing against
  // the wire contract — throws on any mismatch.
  const diagnosis = {
    ...(toolUse.input as Record<string, unknown>),
    promptVersion: prompt.promptVersion,
  };
  validate(diagnosis, schema);
  return diagnosis as unknown as Diagnosis;
}
