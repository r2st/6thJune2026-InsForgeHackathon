// functions/edgeParity.test.ts
// Acceptance tests for the edge-runtime parity guardrail (ticket 0060).
//
// Run: pnpm -F @hush/functions test

import { describe, expect, it } from 'vitest';
import { hasErrors, scanSource, type Violation } from './edgeParity.js';

const rules = (code: string): string[] => scanSource('x.ts', code).violations.map((v) => v.rule);
const find = (code: string, rule: string): Violation | undefined =>
  scanSource('x.ts', code).violations.find((v) => v.rule === rule);

describe('readFileSync — inline-able shapes pass, computed paths fail', () => {
  it('the asset-const form the bundler inlines is clean', () => {
    const code = [
      "const PROMPT_PATH = fileURLToPath(new URL('./prompts/diagnose.v1.md', import.meta.url));",
      "const p = readFileSync(PROMPT_PATH, 'utf8');",
    ].join('\n');
    expect(rules(code)).not.toContain('fs-read-noninlineable');
  });

  it('the direct new URL form is clean', () => {
    const code = "const p = readFileSync(fileURLToPath(new URL('./x.json', import.meta.url)), 'utf8');";
    expect(rules(code)).not.toContain('fs-read-noninlineable');
  });

  it('a computed/runtime path is a build-failing error (the ENOENT class)', () => {
    const code = [
      "const path = resolve(here, '..', 'infra', 'insforge.toml');",
      "return readFileSync(path, 'utf8');",
    ].join('\n');
    const v = find(code, 'fs-read-noninlineable');
    expect(v?.severity).toBe('error');
    expect(v?.message).toMatch(/ENOENT in Deno/);
  });

  it('a readFileSync of a var that is NOT an inline-able asset const fails', () => {
    const code = "return readFileSync(somePath, 'utf8');";
    expect(rules(code)).toContain('fs-read-noninlineable');
  });
});

describe('suppression directive — intentional Node-only fallbacks opt out visibly', () => {
  it('an inline `edge-parity-ignore` on the same line suppresses the error', () => {
    const code = "return readFileSync(path, 'utf8'); // edge-parity-ignore: Node-only fallback, injected at deploy";
    expect(rules(code)).not.toContain('fs-read-noninlineable');
  });

  it('an `edge-parity-ignore` on the previous line also suppresses', () => {
    const code = [
      '// edge-parity-ignore: dev-only path',
      "return readFileSync(path, 'utf8');",
    ].join('\n');
    expect(rules(code)).not.toContain('fs-read-noninlineable');
  });
});

describe('Node-only globals unshimmed by the banner', () => {
  it('__dirname and __filename are errors', () => {
    expect(find('const d = __dirname;', 'node-path-global')?.severity).toBe('error');
    expect(rules('const f = __filename;')).toContain('node-path-global');
  });

  it('process.env is shimmed → allowed', () => {
    expect(rules("const k = process.env.HUSH_TOML_PATH;")).not.toContain('process-beyond-shim');
  });

  it('process.cwd / process.argv / process.platform are errors (only .env is shimmed)', () => {
    expect(rules('const c = process.cwd();')).toContain('process-beyond-shim');
    expect(rules('const a = process.argv;')).toContain('process-beyond-shim');
    expect(rules('const p = process.platform;')).toContain('process-beyond-shim');
  });
});

describe('fs import shape', () => {
  it("bare 'fs' import is an error; node:fs is fine", () => {
    expect(rules("import { readFileSync } from 'fs';")).toContain('bare-fs-import');
    expect(rules("import { readFileSync } from 'node:fs';")).not.toContain('bare-fs-import');
  });

  it('runtime node:fs dynamic import is a warning, not a hard error', () => {
    const v = find("const { writeFileSync } = await import('node:fs');", 'fs-runtime-io');
    expect(v?.severity).toBe('warn');
  });
});

describe('prose & comments do not trip rules', () => {
  it('a readFileSync mentioned in a trailing comment is ignored', () => {
    expect(rules("const x = 1; // we used to readFileSync(thePath) here")).toEqual([]);
  });
});

describe('hasErrors — build-failure policy', () => {
  it('true when any error-severity violation exists', () => {
    expect(hasErrors(scanSource('x.ts', 'const d = __dirname;'))).toBe(true);
  });
  it('false for a warn-only result', () => {
    expect(hasErrors(scanSource('x.ts', "const { x } = await import('node:fs');"))).toBe(false);
  });
  it('false for clean code', () => {
    expect(hasErrors(scanSource('x.ts', "const p = readFileSync(fileURLToPath(new URL('./a', import.meta.url)), 'utf8');"))).toBe(false);
  });
});
