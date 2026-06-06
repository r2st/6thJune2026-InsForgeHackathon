// functions/applyDiff.ts
//
// Apply a proposed TomlPatch to a branch project and make it live, so the fork
// terminal on slide 06 can show "policy orders_select · patched" — the visible
// evidence the fix was actually applied before the replay runs.
//
// Ticket: agents/tasks/0006-apply-toml-diff-to-branch.md
//
// Flow: patch the canonical TOML in memory (tomlPatch.applyPatch — idempotent,
// refuses on mismatch), then `insforge config apply --env <branchId>` against
// the patched file. On success we return the new config version so the PR
// description can link the exact branch config; on failure a structured lint
// error with file:line. The CLI exec is injectable so tests never shell out.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { applyPatch } from './tomlPatch.js';
import { fingerprintSchema } from './fingerprint.js';
import { checkTomlDiffSafety } from './guardrails.js';
import type { TomlPatch } from './types.js';

export type ApplyResult =
  | { ok: true; version: string; changed: boolean; schemaFingerprint?: string }
  | { ok: false; lintError: string };

/** Outcome of the underlying `insforge config apply`. */
export interface CliApplyResult {
  ok: boolean;
  version?: string;
  lintError?: string;
}

export interface ApplyDeps {
  /** Current branch TOML. Defaults to the canonical (buggy) infra/insforge.toml. */
  loadToml: (branchId: string) => string;
  /** Push the patched config to the branch and return its new version. */
  runApply: (branchId: string, patchedToml: string) => Promise<CliApplyResult>;
}

export async function applyTomlDiff(
  branchId: string,
  diff: TomlPatch,
  deps?: Partial<ApplyDeps>,
): Promise<ApplyResult> {
  const loadToml = deps?.loadToml ?? defaultLoadToml;
  const runApply = deps?.runApply ?? defaultRunApply;

  const patched = applyPatch(loadToml(branchId), diff);
  if (!patched.ok) return { ok: false, lintError: patched.error };

  // Guardrail check: ensure the patched TOML doesn't contain dangerous patterns
  const safetyCheck = await checkTomlDiffSafety(patched.toml);
  if (!safetyCheck.safe) {
    return { ok: false, lintError: `Guardrail blocked: ${safetyCheck.reason}` };
  }

  const res = await runApply(branchId, patched.toml);
  if (!res.ok || !res.version) {
    return { ok: false, lintError: res.lintError ?? 'insforge config apply failed (no version)' };
  }
  // Post-apply schema fingerprint (ticket 0034) — lets the orchestrator confirm
  // the branch actually holds the intended patch (catches a silent no-op apply).
  const table = diff.path.split('.')[1] ?? '';
  return {
    ok: true,
    version: res.version,
    changed: patched.changed,
    schemaFingerprint: fingerprintSchema(patched.toml, table),
  };
}

// ── defaults ────────────────────────────────────────────────────────────────

function defaultLoadToml(_branchId: string): string {
  const fromEnv = process.env.HUSH_TOML_PATH;
  const here = dirname(fileURLToPath(import.meta.url));
  const path = fromEnv ?? resolve(here, '..', 'infra', 'insforge.toml');
  return readFileSync(path, 'utf8');
}

/**
 * Run `insforge config apply --env <branchId>` against the patched config piped
 * via a temp file. Lazily imports node:child_process so the pure path (tests,
 * trace-only) never pulls it in. Parses the CLI's version line; a non-zero exit
 * surfaces stderr as the lint error with whatever file:line the CLI reports.
 */
async function defaultRunApply(branchId: string, patchedToml: string): Promise<CliApplyResult> {
  const { execFile } = await import('node:child_process');
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const dir = mkdtempSync(join(tmpdir(), 'hush-apply-'));
  const file = join(dir, 'insforge.toml');
  writeFileSync(file, patchedToml, 'utf8');

  return await new Promise<CliApplyResult>((resolveP) => {
    execFile(
      'insforge',
      ['config', 'apply', '--env', branchId, '--file', file, '--json'],
      { timeout: 3000 },
      (err, stdout, stderr) => {
        if (err) {
          resolveP({ ok: false, lintError: (stderr || err.message).trim() });
          return;
        }
        resolveP({ ok: true, version: parseVersion(stdout) });
      },
    );
  });
}

/** Pull the config version from the CLI's JSON or text output; fall back to a tag. */
function parseVersion(stdout: string): string {
  try {
    const j = JSON.parse(stdout) as { version?: string };
    if (j.version) return j.version;
  } catch {
    const m = /version[:\s]+(\S+)/i.exec(stdout);
    if (m?.[1]) return m[1];
  }
  return 'applied';
}
