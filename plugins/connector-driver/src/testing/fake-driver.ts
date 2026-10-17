import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import type { JsonValue } from '@agent-native/contracts';
import type { DriverContract } from '../contracts';
import type { DriverErrorKind } from '../protocol';
import { driverContractDigest, type DriverMode, type DriverProcess } from '../supervisor';

type Value = string | number | boolean | null;

/** What a fake action does: change state, return a reference, or throw `fakeRefusal(...)`. */
export type FakeAction = (
  input: JsonValue,
  driver: FakeDriver,
) => { readonly ref?: string } | void | Promise<{ readonly ref?: string } | void>;

export interface FakeDriverOptions {
  readonly contract: DriverContract;
  /** Override to act as a driver built for another contract. */
  readonly digest?: string;
  readonly state: Record<string, Value>;
  readonly actions?: Readonly<Record<string, FakeAction>>;
  readonly devices?: readonly { readonly serial?: string; readonly firmware?: string }[];
}

/** Thrown by a fake action to answer with a classified error. */
export class FakeRefusal extends Error {
  constructor(
    readonly kind: DriverErrorKind,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

/**
 * An in-process driver speaking the real protocol over in-memory streams, for tests and demos. It
 * deduplicates `idempotent` actions by effect ID, remembers outcomes for `action.lookup`, refuses
 * actions the mode does not allow, and can be told to lose a reply, fail, crash or skip events.
 */
export function createFakeDriver(options: FakeDriverOptions) {
  const digest = options.digest ?? driverContractDigest(options.contract);
  const outcomes = new Map<
    string,
    { status: 'accepted'; ref?: string } | { status: 'rejected'; code: string; message: string }
  >();
  const applied = new Map<string, number>();
  let current:
    { emit(name: string, payload?: JsonValue, skip?: number): void; exit(): void } | undefined;
  let starts = 0;
  let next: 'crash' | 'hang' | DriverErrorKind | undefined;

  async function invoke(params: {
    action: string;
    input: JsonValue;
    effectId: string;
    mode: DriverMode;
  }) {
    const action = options.contract.actions[params.action];
    if (!action)
      throw new FakeRefusal('rejected', `Unknown action ${params.action}`, 'UNSUPPORTED');
    if (params.mode === 'monitor-only' || (params.mode === 'assist' && action.hazard !== 'none'))
      throw new FakeRefusal('refused', `Mode ${params.mode} does not allow ${params.action}`);
    const known = outcomes.get(params.effectId);
    if (known && action.delivery === 'idempotent') {
      if (known.status === 'rejected') throw new FakeRefusal('rejected', known.message, known.code);
      return { ...(known.ref ? { ref: known.ref } : {}) };
    }
    const failure = next !== 'crash' && next !== 'hang' ? next : undefined;
    if (failure) throw ((next = undefined), new FakeRefusal(failure, `Injected ${failure}`));
    try {
      const answer = (await options.actions?.[params.action]?.(params.input, driver)) ?? {};
      applied.set(params.effectId, (applied.get(params.effectId) ?? 0) + 1);
      outcomes.set(params.effectId, {
        status: 'accepted',
        ...(answer.ref ? { ref: answer.ref } : {}),
      });
      return answer;
    } catch (error) {
      if (error instanceof FakeRefusal && error.kind === 'rejected')
        outcomes.set(params.effectId, {
          status: 'rejected',
          code: error.code ?? 'REJECTED',
          message: error.message,
        });
      throw error;
    }
  }

  async function answer(method: string, params: any): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return {
          driver: { id: `fake-${options.contract.id}`, version: '0.0.0' },
          contract: { digest },
          session: `s${starts}`,
          devices: options.devices ?? [],
        };
      case 'state.read':
        return {
          values: Object.fromEntries(
            (params.fields as string[])
              .filter((field) => field in driver.state)
              .map((field) => [field, driver.state[field]!]),
          ),
          confidence: {},
          at: Date.now(),
        };
      case 'action.invoke':
        return invoke(params);
      case 'action.lookup':
        return outcomes.get(params.effectId) ?? { status: 'unknown' };
      case 'health':
      case 'shutdown':
        return {};
      default:
        throw new FakeRefusal('rejected', `Unknown method ${method}`);
    }
  }

  async function start(): Promise<DriverProcess> {
    starts++;
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const events = new EventEmitter();
    const session = `s${starts}`;
    let seq = 0;
    let alive = true;
    const write = (message: object) =>
      alive && stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
    const exit = () => {
      if (!alive) return;
      alive = false;
      if (current === handle) current = undefined;
      stdout.end();
      queueMicrotask(() => events.emit('exit', 0));
    };
    const handle = {
      emit(name: string, payload?: JsonValue, skip = 0) {
        seq += skip;
        write({
          method: 'event',
          params: {
            session,
            seq: seq++,
            name,
            ...(payload === undefined ? {} : { payload }),
            at: Date.now(),
          },
        });
      },
      exit,
    };
    current = handle;
    createInterface({ input: stdin }).on('line', async (line) => {
      const message = JSON.parse(line) as { id?: number; method: string; params?: unknown };
      if (message.id === undefined) return;
      if (message.method === 'action.invoke' && next === 'hang') return void (next = undefined);
      const crash = message.method === 'action.invoke' && next === 'crash';
      if (crash) next = undefined;
      try {
        const result = await answer(message.method, message.params);
        if (crash) return exit();
        write({ id: message.id, result });
        if (message.method === 'shutdown') exit();
      } catch (error) {
        const refusal =
          error instanceof FakeRefusal ? error : new FakeRefusal('transient', 'Fake failed');
        if (crash) return exit();
        write({
          id: message.id,
          error: {
            code: -32000,
            message: refusal.message,
            data: { kind: refusal.kind, ...(refusal.code ? { code: refusal.code } : {}) },
          },
        });
      }
    });
    return {
      child: {
        stdin,
        stdout,
        stderr,
        on: (event: string, listener: (...args: any[]) => void) => events.on(event, listener),
      } as DriverProcess['child'],
      terminate: exit,
    };
  }

  const driver = {
    state: options.state,
    start,
    /** How often the equipment applied an effect. */
    applied: (effectId: string) => applied.get(effectId) ?? 0,
    get starts() {
      return starts;
    },
    /** Make the next action apply and then crash before answering. */
    crashNext: () => void (next = 'crash'),
    /** Make the next action never answer. */
    hangNext: () => void (next = 'hang'),
    /** Make the next action fail with `kind` before it applies. */
    failNext: (kind: DriverErrorKind) => void (next = kind),
    /** Send an event; `skip` jumps the sequence to simulate lost events. */
    emit: (name: string, payload?: JsonValue, skip?: number) => current?.emit(name, payload, skip),
    /** Crash the running process. */
    crash: () => current?.exit(),
  };
  return driver;
}
export type FakeDriver = ReturnType<typeof createFakeDriver>;
