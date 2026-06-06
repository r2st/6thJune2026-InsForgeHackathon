#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
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
      build.onResolve({ filter: /^node:(fs|url|path|crypto|os|child_process)$/ }, (args) => ({
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
    plugins: [denoExternalsPlugin()],
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
