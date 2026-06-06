// functions/tomlPatch.ts
//
// Apply a structured TomlPatch (types.ts: { path, before, after }) to a TOML
// document, in-place, as text. Pure and idempotent — no I/O, no parser.
//
// Ticket: agents/tasks/0006-apply-toml-diff-to-branch.md
//
// We patch a single scalar string value addressed by a dotted path
// ("tables.orders.rls"): the last segment is the key, the rest is the section
// header ([tables.orders]). The v1 diff shape Hush emits is exactly one RLS
// predicate edit, so this is the whole surface. A full TOML AST is ticket
// 0032's job (validation); here we only need a safe, verifiable string swap
// that preserves surrounding formatting and refuses on a mismatch.

import type { TomlPatch } from './types.js';

export type PatchResult =
  | { ok: true; toml: string; changed: boolean; lineNo: number }
  | { ok: false; error: string };

/**
 * Apply `patch` to `toml`. Succeeds (changed=false) if the target already holds
 * `after` — so re-applying the same patch is a no-op, not an error. Fails with a
 * file-relative line and a one-line reason if the section/key is missing or the
 * current value matches neither `before` nor `after`.
 */
export function applyPatch(toml: string, patch: TomlPatch): PatchResult {
  const segments = patch.path.split('.');
  if (segments.length < 2) {
    return { ok: false, error: `patch path "${patch.path}" must be <section>.<key>` };
  }
  const key = segments[segments.length - 1]!;
  const header = `[${segments.slice(0, -1).join('.')}]`;

  const lines = toml.split('\n');
  const sectionStart = lines.findIndex((l) => l.trim() === header);
  if (sectionStart === -1) {
    return { ok: false, error: `${header} not found` };
  }

  // Scan to the next top-level header (section end) for the key line.
  const keyRe = new RegExp(`^(\\s*${escapeRe(key)}\\s*=\\s*")(.*)("\\s*)$`);
  for (let i = sectionStart + 1; i < lines.length; i++) {
    if (/^\s*\[[^\]]+\]\s*$/.test(lines[i]!)) break; // next section — key absent
    const m = keyRe.exec(lines[i]!);
    if (!m) continue;

    const current = m[2]!;
    if (current === patch.after) {
      return { ok: true, toml, changed: false, lineNo: i + 1 }; // idempotent re-apply
    }
    if (current !== patch.before) {
      return {
        ok: false,
        error: `${header}.${key}:${i + 1} current value does not match patch.before — refusing to clobber`,
      };
    }
    lines[i] = `${m[1]}${patch.after}${m[3]}`;
    return { ok: true, toml: lines.join('\n'), changed: true, lineNo: i + 1 };
  }

  return { ok: false, error: `${header}.${key} not found` };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
