#!/usr/bin/env node
// scripts/check-edge-parity.mjs
// Edge-runtime parity guardrail — CI enforcement (ticket 0060).
//
// Scans functions/**/*.ts for patterns that pass in Node tests but crash in the
// deployed Deno runtime (non-inlineable disk reads, unshimmed Node globals). The
// detection logic is the single source of truth in functions/edgeParity.ts; this
// script loads it (via esbuild type-strip) and applies it across the tree.
//
//   node scripts/check-edge-parity.mjs          # fail (exit 1) on any error
//   node scripts/check-edge-parity.mjs --warn   # also print warnings
//
// Wire into .github/workflows/ci.yml so a regression of the most painful class of
// bug the team already lived through can never merge.

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const functionsDir = join(repoRoot, 'functions');
const showWarnings = process.argv.includes('--warn');

// Load the canonical analyzer from edgeParity.ts (import-free → safe to data-url import).
async function loadAnalyzer() {
  const src = await readFile(join(functionsDir, 'edgeParity.ts'), 'utf8');
  const { code } = await esbuild.transform(src, { loader: 'ts', format: 'esm', target: 'es2022' });
  const mod = await import(`data:text/javascript,${encodeURIComponent(code)}`);
  return mod;
}

async function tsFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'fixtures') continue;
      out.push(...(await tsFiles(full)));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && entry.name !== 'edgeParity.ts') {
      out.push(full);
    }
  }
  return out;
}

const { scanSource } = await loadAnalyzer();
const files = await tsFiles(functionsDir);

let errorCount = 0;
let warnCount = 0;
for (const file of files) {
  const code = await readFile(file, 'utf8');
  const { violations } = scanSource(relative(repoRoot, file), code);
  for (const v of violations) {
    if (v.severity === 'error') errorCount++;
    else warnCount++;
    if (v.severity === 'error' || showWarnings) {
      const tag = v.severity === 'error' ? 'ERROR' : 'warn ';
      console.log(`${tag} ${relative(repoRoot, file)}:${v.line}  [${v.rule}]`);
      console.log(`      ${v.snippet}`);
      console.log(`      → ${v.message}`);
    }
  }
}

const scanned = files.length;
if (errorCount > 0) {
  console.log(`\n✖ edge-parity: ${errorCount} error(s)${warnCount ? `, ${warnCount} warning(s)` : ''} across ${scanned} function file(s).`);
  console.log('  These would crash in the Deno edge runtime. Fix, or annotate intentional Node-only fallbacks with `// edge-parity-ignore: <reason>`.');
  process.exit(1);
}
console.log(`✓ edge-parity: ${scanned} function file(s) clean${warnCount ? ` (${warnCount} warning(s) — run with --warn to see them)` : ''}.`);
