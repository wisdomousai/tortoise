import * as React from 'react';

export interface TapGuardOptions {
  /** Ignore activations this soon after an accepted one (double taps, bouncing pedals). */
  readonly cooldownMs?: number;
  /** A finger that moved further than this was scrolling, not tapping. */
  readonly slopPx?: number;
}
export type TapVerdict = 'accept' | 'pending' | 'cooldown' | 'moved' | 'shifted' | 'orphan';

/**
 * Decides whether an activation is a deliberate tap. Gloved and wet fingers produce the failure
 * modes it rejects: an accidental second tap, a scroll that ends on a button, and a target that
 * moved under the finger because new content appeared (layout shift). A pointer click whose press
 * this guard never saw is an `orphan`: typically the release of a hold on a control that has just
 * turned into a different action, which must not fire that action. Keyboard activations pass
 * their `key`; the cooldown then only suppresses a repeat of the same key (a bouncing pedal),
 * not a different deliberate key. Pure and clock-injected.
 */
export class TapGuard {
  private lastAccepted = -Infinity;
  private lastKey?: string;
  private down?: { x: number; y: number; top: number; left: number };
  constructor(private readonly options: TapGuardOptions = {}) {}
  pointerDown(point: { x: number; y: number }, rect: { top: number; left: number }): void {
    this.down = { ...point, top: rect.top, left: rect.left };
  }
  /** `point`/`rect` are absent for keyboard activation, which only the cooldown applies to. */
  activate(
    at: number,
    state: {
      readonly pending?: boolean;
      readonly point?: { x: number; y: number };
      readonly rect?: { top: number; left: number };
      readonly key?: string;
    } = {},
  ): TapVerdict {
    const { cooldownMs = 400, slopPx = 12 } = this.options;
    const down = this.down;
    this.down = undefined;
    if (state.pending) return 'pending';
    if (state.point && !down) return 'orphan';
    const sameSource = state.key === undefined || state.key === this.lastKey;
    if (sameSource && at - this.lastAccepted < cooldownMs) return 'cooldown';
    if (down && state.point && Math.hypot(state.point.x - down.x, state.point.y - down.y) > slopPx)
      return 'moved';
    if (
      down &&
      state.rect &&
      Math.max(Math.abs(state.rect.top - down.top), Math.abs(state.rect.left - down.left)) > slopPx
    )
      return 'shifted';
    this.lastAccepted = at;
    this.lastKey = state.key;
    return 'accept';
  }
}

/**
 * Wrap a click handler with `TapGuard`. Spread `props` onto the button; `onActivate` runs only
 * for deliberate taps while nothing is pending.
 */
export function useTapGuard(
  onActivate: () => void,
  options: TapGuardOptions & { readonly pending?: boolean } = {},
) {
  const guard = React.useMemo(() => new TapGuard(options), [options.cooldownMs, options.slopPx]);
  const activate = React.useRef(onActivate);
  activate.current = onActivate;
  return {
    props: {
      onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        guard.pointerDown({ x: event.clientX, y: event.clientY }, rect);
      },
      onClick: (event: React.MouseEvent<HTMLElement>) => {
        const keyboard = event.detail === 0;
        const verdict = guard.activate(event.timeStamp, {
          pending: options.pending,
          ...(keyboard
            ? {}
            : {
                point: { x: event.clientX, y: event.clientY },
                rect: event.currentTarget.getBoundingClientRect(),
              }),
        });
        if (verdict === 'accept') activate.current();
        else event.preventDefault();
      },
    },
  };
}
