// Defensive PII stripper for rrweb event payloads before they hit Storage.
//
// rrweb itself masks inputs via the SDK; this is belt-and-braces in case
// a future event type carries embedded headers (network plugin, fetch
// fixture, etc).
//
// Ticket: agents/done/0013-capture-edge-function.md

const FORBIDDEN_HEADERS = new Set(['authorization', 'cookie', 'set-cookie']);

export function scrubPii<T>(value: T): T {
  return walk(value) as T;
}

function walk(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.filter((el) => !isForbiddenHeader(el)).map(walk);
  }
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (FORBIDDEN_HEADERS.has(k.toLowerCase())) continue;
      if (isForbiddenHeader(v)) continue;
      out[k] = walk(v);
    }
    return out;
  }
  return node;
}

function isForbiddenHeader(v: unknown): boolean {
  return (
    !!v &&
    typeof v === 'object' &&
    'name' in v &&
    typeof (v as { name: unknown }).name === 'string' &&
    FORBIDDEN_HEADERS.has((v as { name: string }).name.toLowerCase())
  );
}
