import type { RunEvent } from '../types';

/** Bounded event delivery. A slow consumer receives an explicit replay-required error
 * instead of silently losing state transitions. Snapshots retain recent history. */
export class EventQueue implements AsyncIterableIterator<RunEvent> {
  private queue: RunEvent[] = [];
  private waiting?: { resolve(value: IteratorResult<RunEvent>): void; reject(error: Error): void };
  private closed = false;
  private error?: Error;
  constructor(private readonly onClose: () => void) {}
  push(event: RunEvent) {
    if (this.closed) return;
    if (this.waiting) {
      this.waiting.resolve({ done: false, value: event });
      this.waiting = undefined;
    } else if (this.queue.length >= 256)
      this.end(new Error('Run event consumer fell behind; fetch the run snapshot'));
    else this.queue.push(event);
  }
  end(error?: Error) {
    this.closed = true;
    this.error = error;
    if (this.waiting) {
      error ? this.waiting.reject(error) : this.waiting.resolve({ done: true, value: undefined });
      this.waiting = undefined;
    }
    this.onClose();
  }
  next(): Promise<IteratorResult<RunEvent>> {
    const value = this.queue.shift();
    if (value) return Promise.resolve({ done: false, value });
    if (this.error) return Promise.reject(this.error);
    if (this.closed) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject };
    });
  }
  async return() {
    this.end();
    return { done: true as const, value: undefined };
  }
  [Symbol.asyncIterator]() {
    return this;
  }
}
