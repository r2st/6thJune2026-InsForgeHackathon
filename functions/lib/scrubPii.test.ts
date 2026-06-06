import { describe, it, expect } from 'vitest';
import { scrubPii } from './scrubPii.js';

describe('scrubPii', () => {
  it('strips Authorization / Cookie / Set-Cookie keys', () => {
    const input = {
      type: 'network',
      data: {
        headers: { Authorization: 'Bearer secret', 'X-Trace': 'ok', Cookie: 'sess=...' },
      },
    };
    const out = scrubPii(input) as typeof input;
    expect(out.data.headers).toEqual({ 'X-Trace': 'ok' });
  });

  it('drops { name, value } header objects whose name is forbidden', () => {
    const input = [{ name: 'Set-Cookie', value: 'x=1' }, { name: 'Server', value: 'caddy' }];
    const out = scrubPii(input) as { name: string; value: string }[];
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe('Server');
  });

  it('is case-insensitive on forbidden names', () => {
    const input = { authorization: 'Bearer x' };
    expect(scrubPii(input)).toEqual({});
  });
});
