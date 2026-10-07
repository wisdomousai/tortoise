import * as React from 'react';

const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * Separates single key presses from keyboard-wedge bursts. A scanner types a whole code within a
 * few milliseconds per key, so the first key of a burst looks exactly like a hotkey. Printable
 * keys are therefore held for `windowMs`: if another key follows that quickly, it is a scan and
 * no binding fires, including the scan's terminating Enter or Tab. People cannot press two keys
 * that fast, so a real hotkey fires after a delay they do not notice. Pure and clock-injected.
 */
export class KeyBurstFilter {
  private pending?: { key: string; at: number };
  private lastAt = -Infinity;
  private inBurst = false;
  constructor(private readonly windowMs = 50) {}
  /**
   * Feed a key. Returns `fire` for keys that may act now, `defer` for printable keys that must
   * wait for `settle`, and `drop` for keys that belong to a burst.
   */
  push(key: string, at: number): 'fire' | 'defer' | 'drop' {
    const fast = at - this.lastAt <= this.windowMs;
    this.lastAt = at;
    if (fast && (this.pending || this.inBurst)) {
      this.pending = undefined;
      this.inBurst = true;
      return 'drop';
    }
    this.inBurst = false;
    if (key.length !== 1) return 'fire';
    this.pending = { key, at };
    return 'defer';
  }
  /** Call `windowMs` after a deferred key; returns the key if no burst followed it. */
  settle(at: number): string | undefined {
    const pending = this.pending;
    if (!pending || at - pending.at < this.windowMs || this.lastAt !== pending.at) return undefined;
    this.pending = undefined;
    return pending.key;
  }
}

/**
 * Bind physical keys to station actions: digit keys pick tiles, function keys and foot pedals
 * (which usually emit a configurable key such as F13 or Enter) trigger the primary action. Keys
 * are matched by `KeyboardEvent.key`. Bindings are skipped while an editable field has focus
 * unless `inFields` is set, so typing a value never fires an action. Keyboard-wedge scanner
 * bursts never fire bindings (see `KeyBurstFilter`); set `scanGuardMs` to 0 to disable that.
 */
export function useOperatorKeys(
  bindings: Readonly<Record<string, (() => void) | undefined>>,
  {
    enabled = true,
    inFields = false,
    scanGuardMs = 50,
  }: { enabled?: boolean; inFields?: boolean; scanGuardMs?: number } = {},
) {
  const current = React.useRef(bindings);
  current.current = bindings;
  React.useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const filter = new KeyBurstFilter(scanGuardMs);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const listener = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      if (!inFields && editable(event.target)) return;
      if (scanGuardMs <= 0) {
        const action = current.current[event.key];
        if (!action) return;
        event.preventDefault();
        action();
        return;
      }
      const verdict = filter.push(event.key, event.timeStamp);
      if (verdict === 'drop') return;
      const action = current.current[event.key];
      if (verdict === 'fire') {
        if (!action) return;
        event.preventDefault();
        action();
        return;
      }
      if (action) event.preventDefault();
      clearTimeout(timer);
      const deferredAt = event.timeStamp;
      timer = setTimeout(() => {
        const key = filter.settle(deferredAt + scanGuardMs);
        if (key) current.current[key]?.();
      }, scanGuardMs);
    };
    window.addEventListener('keydown', listener);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', listener);
    };
  }, [enabled, inFields, scanGuardMs]);
}
