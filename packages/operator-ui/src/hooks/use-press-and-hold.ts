import * as React from 'react';

const activates = (key: string) => key === ' ' || key === 'Enter';

/** Whether the pointer slid more than `slopPx` outside the element it started on. */
function outside(event: React.PointerEvent, slopPx: number) {
  const rect = (event.currentTarget as Element).getBoundingClientRect();
  return (
    event.clientX < rect.left - slopPx ||
    event.clientX > rect.right + slopPx ||
    event.clientY < rect.top - slopPx ||
    event.clientY > rect.bottom + slopPx
  );
}

/** Pointer and keyboard handlers that start, abort and release one hold. */
function holdHandlers(
  hold: { begin: () => void; cancel: () => void; release: () => void; holding: () => boolean },
  slopPx: number,
) {
  return {
    onPointerDown: (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      // Keep receiving pointerup even if a gloved finger slides slightly.
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
      hold.begin();
    },
    onPointerMove: (event: React.PointerEvent) => {
      if (!hold.holding()) return;
      // Pointer capture keeps events flowing after the finger leaves, so check the bounds here.
      if (outside(event, slopPx)) hold.cancel();
    },
    onPointerUp: hold.release,
    onPointerCancel: hold.release,
    onLostPointerCapture: hold.release,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (activates(event.key) && !event.repeat) {
        event.preventDefault();
        hold.begin();
      } else if (activates(event.key)) event.preventDefault();
    },
    onKeyUp: (event: React.KeyboardEvent) => {
      if (activates(event.key)) hold.release();
    },
    onBlur: hold.release,
    // A long press must not open the context menu on touch panels.
    onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
  };
}

/**
 * Hold-to-confirm for consequential actions at an operator station. A deliberate hold replaces a
 * confirmation dialog: it cannot be triggered by a brushed touch or a glove resting on the panel,
 * and it needs no second precise tap. Releasing early, sliding more than `slopPx` off the button
 * or cancelling the pointer aborts; small slides of a gloved finger do not. Keyboard and foot-pedal users hold Space or Enter; auto-repeat is ignored.
 * After a confirmation the control must be released before it can confirm again.
 */
export function usePressAndHold({
  durationMs = 900,
  slopPx = 24,
  disabled = false,
  onConfirm,
}: {
  durationMs?: number;
  slopPx?: number;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [progress, setProgress] = React.useState(0);
  const frame = React.useRef<number | undefined>(undefined);
  const started = React.useRef<number | undefined>(undefined);
  const latched = React.useRef(false);
  const confirm = React.useRef(onConfirm);
  confirm.current = onConfirm;

  const cancel = React.useCallback(() => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    started.current = undefined;
    setProgress(0);
  }, []);
  const release = React.useCallback(() => {
    latched.current = false;
    cancel();
  }, [cancel]);
  const begin = React.useCallback(() => {
    if (disabled || latched.current || started.current !== undefined) return;
    started.current = performance.now();
    const tick = (now: number) => {
      if (started.current === undefined) return;
      const value = Math.min(1, (now - started.current) / durationMs);
      setProgress(value);
      if (value >= 1) {
        latched.current = true;
        started.current = undefined;
        frame.current = undefined;
        confirm.current();
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [disabled, durationMs]);

  React.useEffect(() => cancel, [cancel]);
  React.useEffect(() => {
    if (disabled) cancel();
  }, [disabled, cancel]);

  return {
    progress,
    holding: progress > 0 && progress < 1,
    props: holdHandlers(
      { begin, cancel, release, holding: () => started.current !== undefined },
      slopPx,
    ),
  };
}
