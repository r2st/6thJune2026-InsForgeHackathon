import { describe, it, expect } from 'vitest';
import { resolveCaptureSource } from './index';
import { ReplicasCapture, type ReplicasSdk } from './ReplicasCapture';
import { RrwebCapture } from './RrwebCapture';

function fakeSdk(): ReplicasSdk & { started: boolean; stopped: boolean } {
  const state = { started: false, stopped: false };
  return {
    started: false,
    stopped: false,
    startRecording() { state.started = true; (this as { started: boolean }).started = true; },
    stopRecording() { state.stopped = true; (this as { stopped: boolean }).stopped = true; },
    drain() { return { events: [{ type: 2 }], clipUrl: 'https://replicas.example/clip/abc' }; },
  };
}

describe('resolveCaptureSource (0041)', () => {
  it('falls back to rrweb when no Replicas key is set', () => {
    const src = resolveCaptureSource({});
    expect(src.source).toBe('rrweb');
    expect(src instanceof RrwebCapture).toBe(true);
  });

  it('falls back to rrweb when a key is set but no SDK adapter is injected', () => {
    // The honesty rail: a bare key without a wired SDK must NOT claim Replicas.
    const src = resolveCaptureSource({ replicasApiKey: 'rk_test' });
    expect(src.source).toBe('rrweb');
  });

  it('uses Replicas when both key and SDK adapter are present', () => {
    const src = resolveCaptureSource({ replicasApiKey: 'rk_test', replicasSdk: fakeSdk() });
    expect(src.source).toBe('replicas');
    expect(src instanceof ReplicasCapture).toBe(true);
    expect(src.isReady()).toBe(true);
  });
});

describe('ReplicasCapture', () => {
  it('drains the SDK into a bundle tagged replicas, carrying the hosted clip URL', () => {
    const src = new ReplicasCapture({ apiKey: 'rk', sdk: fakeSdk() });
    src.start();
    const bundle = src.flush();
    expect(bundle.source).toBe('replicas');
    expect(bundle.clipUrl).toContain('replicas.example');
    expect(bundle.events.length).toBe(1);
  });

  it('is not ready and yields an empty replicas bundle without an SDK', () => {
    const src = new ReplicasCapture({ apiKey: undefined });
    expect(src.isReady()).toBe(false);
    const bundle = src.flush();
    expect(bundle.source).toBe('replicas');
    expect(bundle.events).toEqual([]);
    expect(bundle.clipUrl).toBeUndefined();
  });

  it('start/stop delegate to the SDK', () => {
    const sdk = fakeSdk();
    const src = new ReplicasCapture({ apiKey: 'rk', sdk });
    src.start();
    src.stop();
    expect(sdk.started).toBe(true);
    expect(sdk.stopped).toBe(true);
  });
});
