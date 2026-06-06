// functions/diagnose.ts
// InsForge AI call: produces a structured Diagnosis from a session + request log + TOML slice.
//
// Ticket: agents/inbox/0018-diagnose-output-schema-and-prompt.md
// Prompt: prompts/diagnose.v1.md
// Schema: schemas/diagnosis.schema.json (the wire contract)

import type { CapturedSession, RequestLogEntry, Diagnosis } from './types.js';

export interface DiagnoseInput {
  session: CapturedSession;
  failingRequest: RequestLogEntry;
  expectedRows: number;
  tomlContext: string;  // output of toml.extractTomlContext()
}

export async function diagnose(_input: DiagnoseInput): Promise<Diagnosis> {
  // TODO(0018):
  //   - Load prompts/diagnose.v1.md and fill the {{...}} placeholders.
  //   - Call the InsForge AI gateway with a forced tool call whose schema
  //     matches schemas/diagnosis.schema.json (no prose parsing).
  //   - Validate the response against the schema; throw on mismatch.
  //   - Stamp promptVersion from the file header.
  throw new Error('not implemented');
}
