'use client';

// apps/demo/app/orders/page.tsx — "My Orders" (ticket 0016).
//
// The demo bug, made visible. A user toggle flips between the legacy user
// (sees 3 orders) and the migrated user (sees an empty page even though the
// orders exist). The migrated case is the one that fires the frustration
// signal: refresh, rage-click, give up.
//
// Plain storefront styling on purpose — this is the "victim" app, not Hush.

import { useCallback, useEffect, useState } from 'react';
import type { Order, UserShape } from '../../lib/hush/orders-fixture';

export default function OrdersPage() {
  const [shape, setShape] = useState<UserShape>('migrated');
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (s: UserShape) => {
    setLoading(true);
    try {
      // Same-origin route handler so the x-hush-session-id shim tags it.
      const res = await fetch(`/api/orders?user=${s}`, { cache: 'no-store' });
      const data = (await res.json()) as { orders: Order[] };
      setOrders(data.orders ?? []);
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(shape);
  }, [shape, load]);

  return (
    <main style={s.wrap}>
      <div style={s.bar}>
        <span style={s.brand}>Acme Store</span>
        <div style={s.toggle}>
          <button
            onClick={() => setShape('legacy')}
            style={{ ...s.tab, ...(shape === 'legacy' ? s.tabOn : {}) }}
          >
            legacy user
          </button>
          <button
            onClick={() => setShape('migrated')}
            style={{ ...s.tab, ...(shape === 'migrated' ? s.tabOn : {}) }}
          >
            migrated user
          </button>
        </div>
      </div>

      <h1 style={s.h1}>My Orders</h1>

      {loading ? (
        <p style={s.muted}>Loading…</p>
      ) : orders && orders.length > 0 ? (
        <ul style={s.list}>
          {orders.map((o) => (
            <li key={o.id} style={s.row}>
              <span style={s.oid}>#{o.id.slice(-4)}</span>
              <span>${o.total.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div style={s.empty}>
          <p style={{ fontWeight: 600, margin: '0 0 6px' }}>You haven&apos;t placed any orders yet.</p>
          <p style={s.muted}>
            (But you have — three of them. The policy just can&apos;t see this user&apos;s JWT shape.)
          </p>
        </div>
      )}

      {/* Payment on file. `maskAllInputs` redacts every input value in the
          rrweb recording; data-hush="mask" makes the masking explicit for the
          demo. The card number never leaves the browser in the clip (0017). */}
      <div style={s.payment}>
        <label style={s.payLabel}>Card on file</label>
        <input
          data-hush="mask"
          defaultValue="4242 4242 4242 4242"
          inputMode="numeric"
          style={s.payInput}
          aria-label="card number (masked in capture)"
        />
        <span style={s.muted}>masked in capture · never stored</span>
      </div>
    </main>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 560, margin: '0 auto', padding: '40px 24px', fontFamily: 'system-ui, sans-serif' },
  bar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 },
  brand: { fontWeight: 700, fontSize: 18, color: '#1a1d22' },
  toggle: { display: 'flex', gap: 4, background: '#f1f3f5', borderRadius: 8, padding: 3 },
  tab: { border: 'none', background: 'transparent', fontSize: 12, padding: '6px 10px', borderRadius: 6, cursor: 'pointer', color: '#5b6470' },
  tabOn: { background: '#fff', color: '#1a1d22', boxShadow: '0 1px 2px rgba(0,0,0,0.08)' },
  h1: { fontSize: 26, margin: '0 0 20px', color: '#1a1d22' },
  list: { listStyle: 'none', padding: 0, margin: 0, border: '1px solid #e4e7eb', borderRadius: 8 },
  row: { display: 'flex', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #f1f3f5' },
  oid: { color: '#5b6470', fontFamily: 'monospace' },
  empty: { border: '1px dashed #d6dae0', borderRadius: 8, padding: '28px 22px', textAlign: 'center', color: '#1a1d22' },
  muted: { color: '#8b94a0', fontSize: 14, margin: 0 },
  payment: { marginTop: 28, paddingTop: 20, borderTop: '1px solid #f1f3f5', display: 'flex', flexDirection: 'column', gap: 6 },
  payLabel: { fontSize: 12, color: '#5b6470', fontWeight: 600 },
  payInput: { padding: '10px 12px', border: '1px solid #d6dae0', borderRadius: 6, fontSize: 14, fontFamily: 'monospace', maxWidth: 220 },
};
