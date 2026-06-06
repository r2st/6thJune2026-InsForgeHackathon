// functions/lib/pool.ts
//
// Reader for the pre-warmed branch-project pool that scripts/prewarm.sh
// (ticket 0004) writes to .hush/pool.json. The orchestrator (0030) claims a
// fork from here; forgeJwt (0007) reads the claimed fork's signing secret;
// applyDiff (0006) targets it by branchId.
//
// State file is gitignored and local-only — it holds per-fork signing secrets.
// This module only *reads*; the prewarm script owns create/claim/top-up so the
// edge functions never block on provisioning.

import { readFileSync } from 'node:fs';

/** One pre-warmed fork, as recorded by scripts/prewarm.sh. */
export interface PoolEntry {
  branchId: string;
  /** Base URL of the fork branch project — replay() targets this. */
  baseUrl: string;
  /** HS256 secret the fork verifies JWTs with. We provisioned the fork, so we hold it. */
  jwtSecret: string;
  /** Fork's expected issuer/audience — forgeJwt rewrites the captured token to these. */
  jwtIssuer?: string;
  jwtAudience?: string;
  /** runId that claimed this fork, or null if free. The prewarm script tops up. */
  claimedBy: string | null;
}

export interface Pool {
  entries: PoolEntry[];
}

/** Resolve the pool file path: HUSH_POOL_FILE, else repo-root .hush/pool.json. */
export function poolPath(): string {
  return process.env.HUSH_POOL_FILE ?? '.hush/pool.json';
}

/** Read and parse the pool file. Throws a clear error if it's missing. */
export function readPool(path = poolPath()): Pool {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(
      `pool: ${path} not found — run scripts/prewarm.sh --count 2 before the demo`,
    );
  }
  const parsed = JSON.parse(raw) as Pool;
  if (!parsed || !Array.isArray(parsed.entries)) {
    throw new Error(`pool: ${path} is malformed — expected { entries: [...] }`);
  }
  return parsed;
}

/** Look up a fork by branch id. Throws if the pool doesn't have it. */
export function getEntry(branchId: string, path = poolPath()): PoolEntry {
  const entry = readPool(path).entries.find((e) => e.branchId === branchId);
  if (!entry) throw new Error(`pool: no entry for branchId ${branchId}`);
  return entry;
}

/**
 * Pick the first free fork (claimedBy === null). Returns null if the pool is
 * exhausted — the orchestrator then falls back to trace-only (ticket 0012)
 * rather than stalling. Claiming/persisting the mark is the prewarm script's
 * job; this is a read-time selection only.
 */
export function firstFree(path = poolPath()): PoolEntry | null {
  return readPool(path).entries.find((e) => e.claimedBy === null) ?? null;
}
