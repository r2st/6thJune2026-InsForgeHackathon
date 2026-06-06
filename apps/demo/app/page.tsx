export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px' }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Hush demo storefront</h1>
      <p style={{ color: '#5b6470', marginBottom: 24 }}>
        The Orders page lands at <code>/orders</code> (ticket 0016).
      </p>
      <p style={{ color: '#5b6470', marginBottom: 4 }}>
        rrweb is recording. Verify in the console:
      </p>
      <pre
        style={{
          background: '#fff',
          border: '1px solid #e4e7eb',
          borderRadius: 6,
          padding: '12px 16px',
          fontSize: 13,
        }}
      >
        Hush.size()   {'// number of buffered events'}
        {'\n'}Hush.peek()   {'// snapshot (does not clear)'}
        {'\n'}Hush.flush()  {'// returns and clears the buffer'}
      </pre>
    </main>
  );
}
