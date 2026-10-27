import { randomUUID } from 'node:crypto';
import {
  ApplicationError,
  osPlatforms,
  type OsActionResult,
  type OsInstruction,
  type OsPlatform,
} from '@agent-native/contracts';
import type { HostSession } from '@agent-native/adapters/http';
import type { ShellPort } from '@agent-native/kernel/shell';

interface Waiting {
  readonly id: string;
  readonly instruction: OsInstruction;
  readonly complete: (result: OsActionResult) => void;
  delivered: boolean;
}
interface Relay {
  readonly session: HostSession;
  readonly queue: Waiting[];
  readonly pending: Map<string, Waiting>;
  detach: () => void;
  wake?: () => void;
  lastPoll: number;
}

/** How long an instruction waits for its adapter's result before it counts as not performed. */
const resultMs = 30_000;
/** A relay whose adapter stopped polling for this long is detached. */
const idleMs = 60_000;

/**
 * Queue an instruction for the relay's adapter and wait for its result. A full queue or no
 * result within `resultMs` counts as not performed.
 */
function enqueue(relay: Relay, instruction: OsInstruction): Promise<OsActionResult> {
  return new Promise<OsActionResult>((resolve) => {
    if (relay.queue.length >= 16) return resolve({ ok: false, detail: 'adapter busy' });
    const timer = setTimeout(() => complete({ ok: false, detail: 'no result' }), resultMs);
    const complete = (result: OsActionResult) => {
      clearTimeout(timer);
      relay.pending.delete(waiting.id);
      const index = relay.queue.indexOf(waiting);
      if (index >= 0) relay.queue.splice(index, 1);
      resolve(result);
    };
    const waiting: Waiting = { id: randomUUID(), instruction, complete, delivered: false };
    relay.queue.push(waiting);
    relay.pending.set(waiting.id, waiting);
    relay.wake?.();
  });
}

/**
 * Shell adapters that run in another process and reach the host over HTTP, as Electron main
 * does. Main long-polls for instructions with its bearer and posts each result back; the shell
 * port sees an ordinary attached adapter. A relay belongs to one session token: only that
 * session can poll it or post results for its instructions, and revoking the session detaches it.
 */
export function createShellRelay(
  shell: () => ShellPort,
  isActive: (token: string) => boolean,
  now: () => number = Date.now,
) {
  const relays = new Map<string, Relay>();

  function sweep() {
    for (const [token, relay] of relays)
      if (!isActive(token) || now() - relay.lastPoll > idleMs) close(token, relay);
  }
  function close(token: string, relay: Relay) {
    relays.delete(token);
    relay.detach();
    for (const waiting of [...relay.queue, ...relay.pending.values()])
      waiting.complete({ ok: false, detail: 'adapter detached' });
    relay.wake?.();
  }

  function attach(session: HostSession, platform: OsPlatform): Relay {
    const relay: Relay = {
      session,
      queue: [],
      pending: new Map(),
      detach: () => undefined,
      lastPoll: now(),
    };
    relay.detach = shell().attach(session.context, {
      platform,
      perform: (instruction) => enqueue(relay, instruction),
    });
    relays.set(session.token, relay);
    return relay;
  }

  return {
    /**
     * The next instruction for this session's adapter, waiting up to `waitMs`. The first poll
     * attaches the adapter for the session's principal; `undefined` means nothing to do yet.
     */
    async next(session: HostSession, platform: string, signal: AbortSignal, waitMs = 25_000) {
      sweep();
      if (!osPlatforms.includes(platform as OsPlatform))
        throw new ApplicationError('INVALID_INPUT', 'Unknown OS platform');
      const relay = relays.get(session.token) ?? attach(session, platform as OsPlatform);
      relay.lastPoll = now();
      const take = () => {
        const waiting = relay.queue.shift();
        if (!waiting) return undefined;
        waiting.delivered = true;
        return { id: waiting.id, instruction: waiting.instruction };
      };
      const ready = take();
      if (ready || signal.aborted) return ready;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, waitMs);
        signal.addEventListener('abort', done, { once: true });
        relay.wake = done;
        function done() {
          clearTimeout(timer);
          if (relay.wake === done) relay.wake = undefined;
          resolve();
        }
      });
      relay.lastPoll = now();
      return relays.get(session.token) === relay ? take() : undefined;
    },
    /** The adapter's result for one delivered instruction; only the polling session may post it. */
    respond(session: HostSession, id: string, result: OsActionResult) {
      const waiting = relays.get(session.token)?.pending.get(id);
      if (!waiting?.delivered) throw new ApplicationError('NOT_FOUND', 'OS action unavailable');
      waiting.complete(result);
    },
    /** Detach every relay, for shutdown. */
    close() {
      for (const [token, relay] of relays) close(token, relay);
    },
  };
}
export type ShellRelay = ReturnType<typeof createShellRelay>;
