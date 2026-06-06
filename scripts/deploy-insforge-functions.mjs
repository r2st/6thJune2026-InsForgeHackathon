#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, '.hush', 'insforge-functions');
const buildOnly = process.argv.includes('--build-only');

const functions = [
  { slug: 'ingest', source: 'functions/ingest.ts' },
  { slug: 'fix-trigger', source: 'functions/fix-trigger.ts' },
];

const processShim = [
  // The InsForge edge runtime is Deno: it has no Node `Buffer` global, which
  // several functions (jwt decode, gzip, diagnose, base64) rely on. Pull it from
  // node:buffer (externalized below) and install it before any module code runs.
  'import { Buffer as __NodeBuffer } from "node:buffer";',
  'globalThis.Buffer = globalThis.Buffer ?? __NodeBuffer;',
  'var process = globalThis.process ?? {',
  '  env: new Proxy({}, {',
  '    get(_target, key) { return globalThis.Deno?.env?.get?.(String(key)); }',
  '  })',
  '};',
].join('\n');

function denoExternalsPlugin() {
  return {
    name: 'deno-externals',
    setup(build) {
      build.onResolve({ filter: /^node:(fs|url|path|crypto|os|child_process|buffer|util)$/ }, (args) => ({
        path: args.path,
        external: true,
      }));
      build.onResolve({ filter: /.*/ }, (args) => {
        if (isBarePackageSpecifier(args.path)) {
          return { path: `npm:${args.path}`, external: true };
        }
        return undefined;
      });
    },
  };
}

function isBarePackageSpecifier(specifier) {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) return false;
  return !/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(specifier);
}

/**
 * Inline sibling-asset reads at build time. Several functions ground themselves
 * on text assets via `readFileSync(fileURLToPath(new URL('./x', import.meta.url)))`
 * — fine in Node, but the asset isn't in the deployed Deno bundle, so it ENOENTs
 * at runtime. This rewrites those reads to the file's literal content during the
 * bundle, so prompts / schemas / toml travel inside the function. Surgical: it
 * only touches the specific readFileSync(...) patterns; everything else passes
 * through untouched and esbuild still transpiles via loader:'ts'.
 */
function inlineAssetReadsPlugin() {
  return {
    name: 'inline-asset-reads',
    setup(build) {
      build.onLoad({ filter: /[/\\]functions[/\\].*\.ts$/ }, async (args) => {
        let src = await readFile(args.path, 'utf8');
        if (!src.includes('readFileSync')) return { contents: src, loader: 'ts' };
        const dir = dirname(args.path);

        // const NAME = fileURLToPath(new URL('./rel', import.meta.url));
        const decl = /const\s+(\w+)\s*=\s*fileURLToPath\(\s*new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)\s*\)\s*;/g;
        const paths = {};
        for (let m; (m = decl.exec(src)); ) paths[m[1]] = m[2];

        for (const [name, rel] of Object.entries(paths)) {
          let lit;
          try {
            lit = JSON.stringify(await readFile(resolve(dir, rel), 'utf8'));
          } catch {
            continue; // asset missing at build time — leave the read as-is
          }
          // readFileSync(NAME, 'utf8') | readFileSync(NAME, "utf8")
          src = src.split(`readFileSync(${name}, 'utf8')`).join(lit)
                   .split(`readFileSync(${name}, "utf8")`).join(lit);
        }

        // direct: readFileSync(fileURLToPath(new URL('./rel', import.meta.url)), 'utf8')
        const direct = /readFileSync\(\s*fileURLToPath\(\s*new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)\s*\)\s*,\s*['"]utf8['"]\s*\)/g;
        const replacements = [];
        for (let m; (m = direct.exec(src)); ) replacements.push([m[0], m[1]]);
        for (const [full, rel] of replacements) {
          try {
            src = src.split(full).join(JSON.stringify(await readFile(resolve(dir, rel), 'utf8')));
          } catch { /* leave as-is */ }
        }

        return { contents: src, loader: 'ts' };
      });
    },
  };
}

async function buildFunction({ slug, source }) {
  const entryFile = join(outDir, `${slug}.entry.ts`);
  const outfile = join(outDir, `${slug}.js`);
  const sourcePath = resolve(repoRoot, source);
  await writeFile(
    entryFile,
    [
      `import importedHandler from ${JSON.stringify(sourcePath)};`,
      'export default async function handler(req: Request): Promise<Response> {',
      '  return importedHandler(req);',
      '}',
      '',
    ].join('\n'),
  );

  await esbuild.build({
    entryPoints: [entryFile],
    outfile,
    bundle: true,
    platform: 'neutral',
    format: 'esm',
    target: 'es2022',
    packages: 'external',
    banner: { js: processShim },
    plugins: [inlineAssetReadsPlugin(), denoExternalsPlugin()],
  });

  await run(process.execPath, ['--check', outfile]);
  return outfile;
}

async function deployFunction(slug, file) {
  await run('npx', ['@insforge/cli', 'functions', 'deploy', slug, '--file', file], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      stdio: options.stdio ?? 'pipe',
      shell: process.platform === 'win32',
    });
    let stderr = '';
    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
    }
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolveRun();
      } else {
        reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}${stderr ? `\n${stderr}` : ''}`));
      }
    });
  });
}

await mkdir(outDir, { recursive: true });

for (const fn of functions) {
  const file = await buildFunction(fn);
  console.log(`built ${fn.slug}: ${file}`);
  if (!buildOnly) {
    await deployFunction(fn.slug, file);
  }
}
