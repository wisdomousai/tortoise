import type { JsonValue } from '@agent-native/contracts';
import {
  abortableSleep,
  AttemptMemory,
  confirm,
  DeliveryFailure,
  DeliveryUncertain,
  deliverConvergent,
  interruption,
  lookupConvergent,
  rejected,
  waitFor,
  type LookupResult,
  type ReadClock,
  type SystemOfRecordPort,
} from '@agent-native/integration';
import type { Effect, EffectOutcome } from '@agent-native/runtime';
import type { DriverAction, DriverCondition, DriverContract } from '../contracts';
import { DriverError, type StateAnswer } from '../protocol';
import type { DriverMode, DriverSupervisor } from '../supervisor';
import { evaluate, readsFor, resolveBinding } from './conditions';

export interface DriverConnectorOptions {
  /** Outbox target served by this connector. */
  readonly target: string;
  readonly contract: DriverContract;
  readonly supervisor: Pick<DriverSupervisor, 'read' | 'invoke' | 'lookup'>;
  /** The bridge mode, read from the application before every action. */
  readonly control: (signal: AbortSignal) => Promise<{ readonly mode: DriverMode }>;
  readonly pollMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** Driver errors that guarantee the equipment was not acted on. */
const untouchedKinds = new Set(['transient', 'rejected', 'precondition', 'refused']);
const empty: StateAnswer = { values: {}, confidence: {}, at: 0 };
const accepted = (ref?: string): EffectOutcome => ({
  status: 'accepted',
  ...(ref ? { externalRef: ref } : {}),
});

/** Why the mode forbids `action` now, or undefined when it may run. */
function blockedBy(mode: DriverMode, action: DriverAction): string | undefined {
  if (mode === 'monitor-only') return 'The driver bridge is in monitor-only mode';
  if (mode === 'assist' && action.hazard !== 'none')
    return `The driver bridge is in assist mode; ${action.title} needs actuate mode`;
  return undefined;
}

/** A payload problem that rejects the effect before anything is read or done. */
function payloadProblem(action: DriverAction, payload: unknown): EffectOutcome | undefined {
  try {
    action.input.parse(payload);
  } catch {
    return rejected('INVALID_PAYLOAD', `${action.title} has an invalid input`);
  }
  if (
    action.hazard === 'operator-present' &&
    !resolveBinding('$input.presence.confirmedBy', payload)
  )
    return rejected('PRECONDITION', `${action.title} needs confirmation at the machine`);
  return undefined;
}

/**
 * An action request that failed. The driver's own classification decides, except when the
 * request may have reached it (exit, timeout, cancellation, a malformed answer): then delivery
 * fails transiently and lookup or readback decides before anything is sent again.
 */
function failed(error: unknown, action: DriverAction): EffectOutcome {
  if (!(error instanceof DriverError)) throw new DeliveryFailure(`${action.title} failed`);
  if (error.kind === 'rejected') return rejected(error.code ?? 'REJECTED', error.message);
  if (error.kind === 'precondition') return rejected('PRECONDITION', error.message);
  if (error.kind === 'uncertain') throw new DeliveryUncertain(error.message);
  throw new DeliveryFailure(error.message);
}

/**
 * Delivers outbox effects to a driver: each effect type names a contract action, and nothing
 * else can be done. Used as an ordinary `SystemOfRecordPort` behind the effect dispatcher.
 *
 * In order:
 * 1. Unknown actions, invalid input and an unconfirmed `operator-present` action are rejected
 *    before anything is read or done.
 * 2. The bridge mode must allow the action's hazard; otherwise the effect waits (transient).
 * 3. Convergent delivery: if the readback already holds, accept without acting; refuse while the
 *    equipment is under local control; reject unmet preconditions. The same order applies to
 *    every mode, with the readback step skipped when the action declares none.
 * 4. Act with the effect ID as the idempotency key. Accept on the driver's answer, or, with a
 *    readback, only once the readback holds across the fields' `stableReads`.
 *
 * Lookup: `idempotent` actions are safe to resend; `once` asks the driver; `convergent` reads back.
 */
export function createDriverConnector(options: DriverConnectorOptions): SystemOfRecordPort {
  const { contract, supervisor } = options;
  const clock: ReadClock = {
    now: options.now ?? Date.now,
    sleep: options.sleep ?? abortableSleep,
    pollMs: options.pollMs ?? 250,
  };
  const attempts = new AttemptMemory();
  const local = (view: StateAnswer) =>
    contract.control && view.values[contract.control.field] === contract.control.local;

  /** Read the fields a delivery needs; nothing at all when it needs none. */
  const observer = (action: DriverAction) => {
    const fields = [
      ...new Set([
        ...(action.readback ?? []).map((item) => item.field),
        ...(action.preconditions ?? []).map((item) => item.field),
        ...(contract.control ? [contract.control.field] : []),
      ]),
    ];
    return (signal: AbortSignal) =>
      fields.length ? supervisor.read(fields, signal) : Promise.resolve(empty);
  };
  const confirmed =
    (
      observe: (signal: AbortSignal) => Promise<StateAnswer>,
      conditions: readonly DriverCondition[],
      input: unknown,
    ) =>
    (first: StateAnswer, signal: AbortSignal) =>
      confirm(
        clock,
        observe,
        (view) => evaluate(contract, view, conditions, input),
        readsFor(contract, conditions),
        first,
        signal,
      );

  async function act(
    effect: Readonly<Effect>,
    action: DriverAction,
    observe: (signal: AbortSignal) => Promise<StateAnswer>,
    signal: AbortSignal,
  ) {
    let ref: string | undefined;
    try {
      ref = (await supervisor.invoke(effect.type, effect.payload as JsonValue, effect.id, signal))
        .ref;
      attempts.touch(effect.id);
    } catch (error) {
      // The driver's own refusals mean nothing was done; anything else may have reached the equipment.
      if (!(error instanceof DriverError && untouchedKinds.has(error.kind)))
        attempts.touch(effect.id);
      return failed(error, action);
    }
    if (!action.readback?.length) return accepted(ref);
    const shown = await waitFor(
      clock,
      observe,
      (view) => evaluate(contract, view, action.readback!, effect.payload).met,
      action.timeoutMs,
      signal,
      readsFor(contract, action.readback),
    );
    if (shown.matched) return accepted(ref);
    throw interruption(
      true,
      false,
      `${action.title} ran but the equipment does not show the result`,
    );
  }

  async function deliver(effect: Readonly<Effect>, signal: AbortSignal): Promise<EffectOutcome> {
    signal.throwIfAborted();
    const action = contract.actions[effect.type];
    if (!action) return rejected('UNSUPPORTED', `No driver action for ${effect.type}`);
    const problem = payloadProblem(action, effect.payload);
    if (problem) return problem;
    attempts.attempt(effect.id);
    const blocked = blockedBy((await options.control(signal)).mode, action);
    if (blocked) throw new DeliveryFailure(blocked);
    const observe = observer(action);
    return deliverConvergent(
      {
        title: action.title,
        observe,
        converged: action.readback?.length
          ? confirmed(observe, action.readback, effect.payload)
          : async (view) => ({ view, met: false, unmet: [], unknown: [] }),
        accepted: () => accepted(),
        notReady: (view) => (local(view) ? `${contract.title} is under local control` : undefined),
        preconditions: confirmed(observe, action.preconditions ?? [], effect.payload),
        act: (_view, inner) => act(effect, action, observe, inner),
      },
      signal,
    );
  }

  async function lookup(
    _id: string,
    signal: AbortSignal,
    effect?: Readonly<Effect>,
  ): Promise<LookupResult> {
    const action = effect && contract.actions[effect.type];
    if (!effect || !action || action.delivery === 'idempotent') return undefined;
    if (action.delivery === 'once') {
      const found = await supervisor.lookup(effect.id, signal);
      if (found.status === 'unknown') return undefined;
      if (found.status === 'uncertain') return found;
      return found.status === 'accepted'
        ? accepted(found.ref)
        : rejected(found.code, found.message);
    }
    const observe = observer(action);
    return lookupConvergent(
      {
        effect,
        rerunnable: false,
        untouched: attempts.untouched(effect.id),
        readback: async (inner) =>
          confirmed(observe, action.readback!, effect.payload)(await observe(inner), inner),
        accepted: () => accepted(),
        atStart: () => false,
        uncertain: () =>
          `${contract.title} does not show the result of an interrupted ${action.title}`,
      },
      signal,
    );
  }

  return {
    describe: () => ({
      target: options.target,
      idempotentDelivery: Object.values(contract.actions).every(
        (item) => item.delivery === 'idempotent',
      ),
    }),
    deliver,
    lookup,
  };
}
