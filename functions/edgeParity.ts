// functions/edgeParity.ts
// Edge-runtime parity guardrail — fail the build on code that works in Node tests
// but crashes in the deployed Deno runtime.
//
// Ticket:  agents/tasks/0060-edge-runtime-parity-guardrail.md
// Defends: 263 mocked unit tests passed while the live function crashed at every
//          stage, because tests run in Node and the runtime is Deno
//          (`Buffer is not defined`, `ENOENT` reading insforge.toml/prompts/schemas
//          from disk). That gap must be closed by tooling, not vigilance.
//
// Pure, testable core (import-free so the CI script can load it standalone): scan a
// function source for patterns that won't survive the bundle→Deno trip, encoding
// the EXACT bundler contract from scripts/deploy-insforge-functions.mjs:
//   - the banner shims ONLY `Buffer` and `process.env` → `process.<other>`,
//     `__dirname`, `__filename` are unshimmed and crash.
//   - the inline-asset plugin rewrites ONLY `readFileSync(ASSET, 'utf8')` where
//     ASSET = `fileURLToPath(new URL('./rel', import.meta.url))` (or the direct
//     form). A `readFileSync` of any COMPUTED/runtime path can't be inlined and
//     ENOENTs in Deno.
// Intentional Node-only fallbacks (injected/overridden at deploy) opt out with a
// `// edge-parity-ignore[: reason]` directive on the same or previous line — so the
// invariant is enforced and every exception is visible, not silent.

export type Severity = 'error' | 'warn';

export interface Violation {
  rule: string;
  severity: Severity;
  line: number;        // 1-indexed
  snippet: string;     // the offending line, trimmed
  message: string;
}

export interface ScanResult {
  file: string;
  violations: Violation[];
}

const IGNORE_DIRECTIVE = /edge-parity-ignore\b/;

/**
 * Scan one function source. `file` is used only for reporting. Returns every
 * violation; the caller decides build-failure policy (any `error` fails CI).
 */
export function scanSource(file: string, code: string): ScanResult {
  const lines = code.split('\n');
  const violations: Violation[] = [];

  // Asset vars declared via the inline-able form the bundler understands.
  const assetVars = collectAssetVars(code);

  const suppressed = (idx: number): boolean => {
    const here = lines[idx] ?? '';
    const prev = idx > 0 ? lines[idx - 1] ?? '' : '';
    return IGNORE_DIRECTIVE.test(here) || IGNORE_DIRECTIVE.test(prev);
  };

  lines.forEach((raw, i) => {
    const line = i + 1;
    const text = stripLineComment(raw);
    if (text.trim() === '') return;

    // 1. readFileSync — allowed only in the inline-able shapes.
    for (const call of findReadFileSyncCalls(text)) {
      if (isInlineableRead(call, assetVars)) continue;
      if (suppressed(i)) continue;
      violations.push({
        rule: 'fs-read-noninlineable', severity: 'error', line, snippet: raw.trim(),
        message: 'readFileSync of a computed/runtime path cannot be inlined by the bundler and will ENOENT in Deno. ' +
          "Use `readFileSync(fileURLToPath(new URL('./asset', import.meta.url)), 'utf8')` so it's inlined, " +
          'inject the content, or add `// edge-parity-ignore: <reason>` if this path is a Node-only fallback overridden at deploy.',
      });
    }

    // 2. Async fs reads / fs writes that the inline plugin does NOT handle.
    if (/\bfrom\s+['"]fs['"]/.test(text) || /\brequire\(\s*['"]fs['"]\s*\)/.test(text)) {
      if (!suppressed(i)) violations.push({
        rule: 'bare-fs-import', severity: 'error', line, snippet: raw.trim(),
        message: "import from bare 'fs' is not resolvable in the Deno bundle — use 'node:fs' (externalized) and inline any asset reads.",
      });
    }
    if (/await\s+import\(\s*['"]node:fs(\/promises)?['"]\s*\)/.test(text) || /\breadFile\s*\(/.test(text)) {
      if (!suppressed(i)) violations.push({
        rule: 'fs-runtime-io', severity: 'warn', line, snippet: raw.trim(),
        message: 'runtime node:fs I/O may not behave in Deno edge — confirm it runs via a subprocess/CLI path, or add `// edge-parity-ignore: <reason>`.',
      });
    }

    // 3. Node-only path globals — unshimmed by the banner.
    for (const g of ['__dirname', '__filename']) {
      if (new RegExp(`\\b${g}\\b`).test(text) && !suppressed(i)) {
        violations.push({
          rule: 'node-path-global', severity: 'error', line, snippet: raw.trim(),
          message: `${g} is undefined in the Deno runtime. Use new URL(import.meta.url) instead.`,
        });
      }
    }

    // 4. process.<x> beyond the shimmed `.env`.
    for (const m of text.matchAll(/\bprocess\.(\w+)/g)) {
      const prop = m[1];
      if (prop === 'env' || prop === undefined) continue;
      if (suppressed(i)) continue;
      violations.push({
        rule: 'process-beyond-shim', severity: 'error', line, snippet: raw.trim(),
        message: `process.${prop} is not shimmed (the banner provides only process.env). It is undefined in Deno — use globalThis.Deno or process.env.`,
      });
    }
  });

  return { file, violations };
}

/** True when a scan result has at least one build-failing violation. */
export function hasErrors(result: ScanResult): boolean {
  return result.violations.some((v) => v.severity === 'error');
}

// ── internals ──────────────────────────────────────────────────────────────────────

/** Names declared as `const NAME = fileURLToPath(new URL('...', import.meta.url));`. */
function collectAssetVars(code: string): Set<string> {
  const set = new Set<string>();
  const decl = /const\s+(\w+)\s*=\s*fileURLToPath\(\s*new URL\(\s*['"][^'"]+['"]\s*,\s*import\.meta\.url\s*\)\s*\)/g;
  for (let m; (m = decl.exec(code)); ) if (m[1]) set.add(m[1]);
  return set;
}

interface ReadCall { argText: string; }

/** Extract the argument text of each `readFileSync(...)` call on a line. */
function findReadFileSyncCalls(text: string): ReadCall[] {
  const calls: ReadCall[] = [];
  const re = /readFileSync\s*\(/g;
  for (let m; (m = re.exec(text)); ) {
    const argText = balancedArgs(text, m.index + m[0].length - 1);
    if (argText !== null) calls.push({ argText });
  }
  return calls;
}

/** Is this readFileSync call one the inline-asset plugin will rewrite at build time? */
function isInlineableRead(call: ReadCall, assetVars: Set<string>): boolean {
  const a = call.argText;
  // readFileSync(ASSET_VAR, 'utf8')
  const varForm = /^\s*(\w+)\s*,\s*['"]utf8['"]\s*$/.exec(a);
  if (varForm && varForm[1] && assetVars.has(varForm[1])) return true;
  // readFileSync(fileURLToPath(new URL('./rel', import.meta.url)), 'utf8')
  if (/^\s*fileURLToPath\(\s*new URL\(\s*['"][^'"]+['"]\s*,\s*import\.meta\.url\s*\)\s*\)\s*,\s*['"]utf8['"]\s*$/.test(a)) return true;
  return false;
}

/** Given the index of an opening paren, return the text between it and its match. */
function balancedArgs(text: string, openIdx: number): string | null {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return text.slice(openIdx + 1, i);
    }
  }
  return null; // unbalanced on this line (multi-line call) — treat as not-inlineable elsewhere
}

/** Drop a trailing line comment so `// ...readFileSync(x)` in prose doesn't trip rules. */
function stripLineComment(line: string): string {
  const idx = line.indexOf('//');
  return idx === -1 ? line : line.slice(0, idx);
}
