// Gzip helper using the Web Streams API (works in Deno / Edge runtimes / Node 18+).

export async function gzipJson(value: unknown): Promise<Uint8Array> {
  const json = JSON.stringify(value);
  const blob = new Blob([json], { type: 'application/json' });
  const stream = blob.stream().pipeThrough(new CompressionStream('gzip'));
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    if (chunk) chunks.push(chunk);
  }
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
