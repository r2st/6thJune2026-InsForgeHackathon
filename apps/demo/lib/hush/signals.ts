// Frustration-signal detector — rage-click, dead-click, abandoned-form.
//
// Ticket: agents/tasks/0024-frustration-signal-detector.md
//
// Pure detection. No transport. Hands a Signal to onSignal; the caller
// decides what to do with it (typically: pull the capture buffer and
// send to the /capture edge function — ticket 0013).

export type SignalKind = 'rage_click' | 'dead_click' | 'abandoned_form';

export interface Signal {
  kind: SignalKind;
  /** Best-effort CSS-ish path for the offending target. */
  target?: string;
  /** Page URL at signal time. */
  url: string;
  /** ms since epoch. */
  at: number;
}

export interface SignalsOptions {
  onSignal: (s: Signal) => void;
  cooldownMs?: number;
  rageWindowMs?: number;
  rageClicks?: number;
  ragePxRadius?: number;
  deadClickMs?: number;
}

interface ClickRecord {
  target: EventTarget | null;
  x: number;
  y: number;
  at: number;
}

interface FormState {
  hasInput: boolean;
  submitted: boolean;
}

const DEFAULTS = {
  cooldownMs: 5_000,
  rageWindowMs: 1_000,
  rageClicks: 3,
  ragePxRadius: 30,
  deadClickMs: 400,
};

function targetPath(t: EventTarget | null): string | undefined {
  if (!(t instanceof Element)) return undefined;
  const parts: string[] = [];
  let el: Element | null = t;
  while (el && parts.length < 5) {
    let part = el.tagName.toLowerCase();
    if (el.id) part += `#${el.id}`;
    else if (el.classList.length) part += `.${Array.from(el.classList).slice(0, 2).join('.')}`;
    parts.unshift(part);
    el = el.parentElement;
  }
  return parts.join('>');
}

/**
 * Install detectors. Returns a `stop()` function. Pure — no DOM mutation,
 * no network calls. The caller's `onSignal` is the side-effect boundary.
 */
export function start(opts: SignalsOptions): () => void {
  const cfg = { ...DEFAULTS, ...opts };
  let lastSignalAt = 0;
  const recentClicks: ClickRecord[] = [];
  const formStates = new WeakMap<HTMLFormElement, FormState>();
  let recentFetchAt = 0;

  function emit(s: Signal): void {
    if (s.at - lastSignalAt < cfg.cooldownMs) return;
    lastSignalAt = s.at;
    opts.onSignal(s);
  }

  // --- rage-click + dead-click on every click ---
  function onClick(e: MouseEvent): void {
    const at = Date.now();
    recentClicks.push({ target: e.target, x: e.clientX, y: e.clientY, at });
    const cutoff = at - cfg.rageWindowMs;
    while (recentClicks.length > 0 && recentClicks[0]!.at < cutoff) recentClicks.shift();

    // rage-click: ≥N clicks on same target OR within ragePxRadius in window
    if (recentClicks.length >= cfg.rageClicks) {
      const sameTarget = recentClicks.every((c) => c.target === e.target);
      const tight = recentClicks.every(
        (c) =>
          Math.abs(c.x - e.clientX) <= cfg.ragePxRadius &&
          Math.abs(c.y - e.clientY) <= cfg.ragePxRadius,
      );
      if (sameTarget || tight) {
        emit({
          kind: 'rage_click',
          target: targetPath(e.target),
          url: typeof location === 'undefined' ? '' : location.href,
          at,
        });
        recentClicks.length = 0;
        return;
      }
    }

    // dead-click: arm a watcher for the next deadClickMs
    const armedAt = at;
    const mutationSeen = { v: false };
    const observer =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver(() => {
            mutationSeen.v = true;
          })
        : null;
    observer?.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
    setTimeout(() => {
      observer?.disconnect();
      const sawNetwork = recentFetchAt > armedAt;
      if (!mutationSeen.v && !sawNetwork) {
        emit({
          kind: 'dead_click',
          target: targetPath(e.target),
          url: typeof location === 'undefined' ? '' : location.href,
          at: armedAt,
        });
      }
    }, cfg.deadClickMs);
  }

  // --- abandoned-form ---
  function onInput(e: Event): void {
    const form = (e.target as Element | null)?.closest('form');
    if (!form) return;
    const state = formStates.get(form) ?? { hasInput: false, submitted: false };
    state.hasInput = true;
    formStates.set(form, state);
  }

  function onSubmit(e: Event): void {
    const form = e.target as HTMLFormElement | null;
    if (!form) return;
    const state = formStates.get(form) ?? { hasInput: false, submitted: false };
    state.submitted = true;
    formStates.set(form, state);
  }

  function checkAbandons(reason: 'unload' | 'route'): void {
    if (typeof document === 'undefined') return;
    for (const form of Array.from(document.querySelectorAll('form'))) {
      const state = formStates.get(form);
      if (state?.hasInput && !state.submitted) {
        emit({
          kind: 'abandoned_form',
          target: targetPath(form),
          url: typeof location === 'undefined' ? '' : location.href,
          at: Date.now(),
        });
        // Only one abandoned-form signal per unload/route — return on first.
        return;
      }
    }
    void reason;
  }

  // --- fetch interception (only to time dead-clicks) ---
  const origFetch =
    typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function'
      ? globalThis.fetch.bind(globalThis)
      : null;
  if (origFetch) {
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      recentFetchAt = Date.now();
      return origFetch(...args);
    }) as typeof fetch;
  }

  // --- listener install ---
  document.addEventListener('click', onClick, true);
  document.addEventListener('input', onInput, true);
  document.addEventListener('submit', onSubmit, true);
  window.addEventListener('beforeunload', () => checkAbandons('unload'));
  window.addEventListener('popstate', () => checkAbandons('route'));

  return function stop(): void {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('submit', onSubmit, true);
    if (origFetch) globalThis.fetch = origFetch;
  };
}
