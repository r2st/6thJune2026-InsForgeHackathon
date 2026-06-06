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
// Type-only import — erased at compile time, so importing this module for the
// pure-helper unit tests never resolves @anthropic-ai/sdk at runtime. The
// constructor is loaded dynamically inside diagnose(), the only code path that
// actually needs it.
import type Anthropic from '@anthropic-ai/sdk';

import type { CapturedSession, RequestLogEntry, Diagnosis } from './types.js';
import { validate, type JsonSchema } from './lib/validateSchema.js';

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
}

// ── Prompt + schema loading ──────────────────────────────────────────────────
// Read both as files so prompts/diagnose.v1.md and schemas/diagnosis.schema.json
// stay the single source of truth (functions/README.md house rule: prompt and
// schema versions move together). Loaded once at module init.

const PROMPT_PATH = fileURLToPath(new URL('./prompts/diagnose.v1.md', import.meta.url));
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
    promptVersion: versionMatch[1],
    system: systemMatch[1].trim(),
    userTemplate: userMatch[1].trim(),
  };
}

let _prompt: PromptParts | null = null;
function getPrompt(): PromptParts {
  return (_prompt ??= parsePrompt(readFileSync(PROMPT_PATH, 'utf8')));
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
    if (!(key in vars)) throw new Error(`diagnose template: no value for {{${key}}}`);
    return vars[key];
  });
}

/** Build the user message from a DiagnoseInput. Exported for tests. */
export function buildUserMessage(input: DiagnoseInput): string {
  const { session, failingRequest, expectedRows, tomlContext, jwtClaims } = input;
  return fillTemplate(getPrompt().userTemplate, {
    sessionId: session.sessionId,
    userId: session.userId,
    tenantId: session.tenantId,
    frustrationAt: session.frustrationAt ?? '(none)',
    expectedRows: String(expectedRows),
    method: failingRequest.method,
    path: failingRequest.route,
    jwtClaims: jwtClaims ? JSON.stringify(jwtClaims) : '(not captured)',
    rlsDecisions: JSON.stringify(failingRequest.rlsDecisions ?? []),
    returnedRows: String(failingRequest.returnedRows ?? 0),
    tomlContext: tomlContext.trim() || '(empty)',
  });
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

// ── The call ────────────────────────────────────────────────────────────────────

export async function diagnose(input: DiagnoseInput): Promise<Diagnosis> {
  const { system } = getPrompt();
  const schema = getSchema();

  // Load the SDK lazily; `new Anthropic()` resolves ANTHROPIC_API_KEY from the
  // environment and throws a clear error if it's unset — no need to pre-check.
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();

  const response = await client.messages.create({
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
        input_schema: buildToolInputSchema(schema) as Anthropic.Tool['input_schema'],
      },
    ],
    // Force the tool so the response is schema-shaped, never prose. (Forcing a
    // tool is incompatible with extended thinking, which is why we don't enable
    // it here — the reasoning happens while the model constructs the args.)
    tool_choice: { type: 'tool', name: 'emit_diagnosis' },
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === 'tool_use' && block.name === 'emit_diagnosis',
  );
  if (!toolUse) {
    throw new Error(
      `diagnose: model did not call emit_diagnosis (stop_reason=${response.stop_reason})`,
    );
  }

  // Stamp the prompt version ourselves, then validate the whole thing against
  // the wire contract — throws on any mismatch.
  const diagnosis = {
    ...(toolUse.input as Record<string, unknown>),
    promptVersion: getPrompt().promptVersion,
  };
  validate(diagnosis, schema);
  return diagnosis as unknown as Diagnosis;
}
