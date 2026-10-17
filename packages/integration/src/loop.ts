/** Resolve after `ms`, or as soon as `signal` aborts. Never rejects. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    // A signal aborted before the sleep starts (a stop right after a start) adds no listener event.
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export interface Loop {
  start(intervalMs: number): void;
  stop(): Promise<void>;
}

/** Repeat a pass at an interval until stopped; `stop` aborts the pass in flight and waits for it. */
export function createLoop(runOnce: (signal: AbortSignal) => Promise<unknown>): Loop {
  let controller: AbortController | undefined;
  let running: Promise<void> | undefined;
  return {
    start(intervalMs) {
      if (controller) return;
      const active = new AbortController();
      controller = active;
      running = (async () => {
        while (!active.signal.aborted) {
          // A failed pass must not stop background synchronization; the next pass retries.
          await runOnce(active.signal).catch(() => undefined);
          await abortableSleep(intervalMs, active.signal);
        }
      })();
    },
    async stop() {
      controller?.abort();
      await running;
      controller = undefined;
      running = undefined;
    },
  };
}
