import { describe, it, expect } from 'vitest';
import { dispatchFix, type ReplicasHttp } from './replicasAgent.js';

const input = {
  name: 'hush-fix-orders-rls',
  message: 'Patch insforge.toml orders_select to read tenant_ids[] …',
  environmentId: 'env-1',
};

function http(resp: { ok: boolean; status: number; json: unknown }): ReplicasHttp & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    async post(path, apiKey, body) { calls.push({ path, apiKey, body }); return resp; },
  };
}

describe('dispatchFix (0044) — Replicas at the fix step', () => {
  it('no-ops without an API key (default ship path stays source of truth)', async () => {
    const r = await dispatchFix(input, { environmentId: 'env-1' });
    expect(r.dispatched).toBe(false);
    expect(r.reason).toBe('no_key');
  });

  it('no-ops without an environment id', async () => {
    const r = await dispatchFix({ ...input, environmentId: undefined }, { apiKey: 'k' });
    expect(r.dispatched).toBe(false);
    expect(r.reason).toBe('no_environment');
  });

  it('posts to /v1/replica with bearer auth and the fix message, returns the PR url', async () => {
    const h = http({
      ok: true,
      status: 201,
      json: { replica: { id: 'r1', status: 'preparing', pull_requests: [{ repository: 'acme/app', number: 7, url: 'https://github.com/acme/app/pull/7' }] } },
    });
    const r = await dispatchFix(input, { apiKey: 'k', http: h });
    expect(r.dispatched).toBe(true);
    expect(r.replicaId).toBe('r1');
    expect(r.prUrl).toBe('https://github.com/acme/app/pull/7');
    const call = h.calls[0] as { path: string; apiKey: string; body: Record<string, unknown> };
    expect(call.path).toBe('/v1/replica');
    expect(call.apiKey).toBe('k');
    expect(call.body.coding_agent).toBe('claude');
    expect(call.body.environment_id).toBe('env-1');
  });

  it('returns dispatched:true with null prUrl when the PR is still preparing', async () => {
    const h = http({ ok: true, status: 201, json: { replica: { id: 'r2', status: 'preparing' } } });
    const r = await dispatchFix(input, { apiKey: 'k', http: h });
    expect(r.dispatched).toBe(true);
    expect(r.prUrl).toBeNull();
    expect(r.status).toBe('preparing');
  });

  it('maps a non-ok response to a benign error result', async () => {
    const h = http({ ok: false, status: 401, json: { error: 'unauthorized' } });
    const r = await dispatchFix(input, { apiKey: 'bad', http: h });
    expect(r.dispatched).toBe(false);
    expect(r.reason).toBe('error');
  });

  it('never throws — a thrown HTTP maps to error', async () => {
    const boom: ReplicasHttp = { async post() { throw new Error('network'); } };
    const r = await dispatchFix(input, { apiKey: 'k', http: boom });
    expect(r.dispatched).toBe(false);
    expect(r.reason).toBe('error');
  });
});
