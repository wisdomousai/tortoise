import type { Effect, EffectOutcome } from '@agent-native/runtime';
import {
  DeliveryFailure,
  DeliveryUncertain,
  type LookupResult,
  type SystemOfRecordPort,
} from '@agent-native/integration';
import type {
  ComputerUseDriver,
  Extractor,
  Frame,
  Point,
  ScreenAction,
  ScreenTransport,
} from './ports';
import { createPerception, evaluate, type View } from './perceive';
import {
  center,
  contains,
  findNode,
  resolveBinding,
  type Procedure,
  type StationProfile,
} from './profile';

/**
 * Bridge state the controller obeys, read from the application through the bridge principal's
 * control query before every action. `monitor-only` never acts; `assist` runs hazard-free
 * procedures only; `actuate` runs every declared procedure. Whoever holds the seat owns the screen.
 */
export interface BridgeControl {
  readonly mode: 'monitor-only' | 'assist' | 'actuate';
  readonly seat: 'operator' | 'agent' | 'idle';
}

export interface StationConnectorOptions {
  /** Outbox target served by this connector. */
  readonly target?: string;
  readonly profile: StationProfile;
  readonly transport: ScreenTransport;
  readonly extractors: readonly Extractor[];
  readonly driver: ComputerUseDriver;
  readonly control: (signal: AbortSignal) => Promise<BridgeControl>;
  readonly pollMs?: number;
  /** Injected for tests; defaults to `Date.now` and timers. */
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
  });

const rejected = (code: string, message: string): EffectOutcome => ({
  status: 'rejected',
  code,
  message: message.slice(0, 500),
});

/**
 * Executes outbox effects on station software through its screen: the outbound half of the
 * bridge, used as an ordinary `SystemOfRecordPort` behind the effect dispatcher. Each effect type
 * maps to a declared procedure of the station profile; nothing else can be done.
 *
 * Guarantees, in order:
 * 1. Nothing runs unless the bridge mode allows the procedure's hazard and the operator does not
 *    hold the seat. A blocked effect stays pending (transient failure) and is retried later.
 * 2. If the screen already shows the desired state, the effect is accepted without acting
 *    (convergence makes screen actions idempotent).
 * 3. Unmet preconditions reject the effect as business data (`PRECONDITION`); nothing is done.
 * 4. Before every action the control state and local input are checked again, the expected screen
 *    is verified, and the resolved point is refused inside any forbidden region.
 * 5. Acceptance is a readback: observed values matching the request, never "the clicks worked".
 * 6. Once anything was done, an interruption is `DeliveryUncertain` (held for a person to
 *    reconcile) unless the procedure is declared `rerunnable`.
 */
export function createStationConnector(options: StationConnectorOptions): SystemOfRecordPort {
  const target = options.target ?? 'legacy-hmi';
  const perception = createPerception(options.profile, options.extractors);
  const procedures = new Map(
    options.profile.procedures.map((procedure) => [procedure.id, procedure]),
  );
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const pollMs = options.pollMs ?? 250;
  // Effects this process attempted, and the subset where it touched the screen. A failed attempt
  // that never acted is safe to redeliver; after a restart the memory is gone and lookup falls
  // back to the conservative screen rule.
  const attempted = new Set<string>();
  const touched = new Set<string>();

  const observe = async (signal: AbortSignal): Promise<View> =>
    perception.view(await options.transport.capture(signal), signal);

  function blockedBy(control: BridgeControl, procedure: Procedure): string | undefined {
    if (control.seat === 'operator') return 'The operator has the station';
    if (control.mode === 'monitor-only') return 'The bridge is in monitor-only mode';
    if (control.mode === 'assist' && procedure.hazard !== 'none')
      return `The bridge is in assist mode; ${procedure.title} needs actuate mode`;
    return undefined;
  }

  function forbiddenAt(frame: Frame, point: Point): string | undefined {
    for (const zone of options.profile.forbidden) {
      if (zone.region && contains(zone.region, point)) return zone.id;
      const node = zone.locator ? findNode(frame.accessibility, zone.locator) : undefined;
      if (node?.box && contains(node.box, point)) return zone.id;
    }
    return undefined;
  }

  /** Poll until the predicate holds; on timeout returns the last view, unmatched. */
  async function waitFor(
    predicate: (view: View) => boolean,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<{ readonly view: View; readonly matched: boolean }> {
    const deadline = now() + timeoutMs;
    for (;;) {
      const view = await observe(signal);
      if (predicate(view)) return { view, matched: true };
      if (now() >= deadline || signal.aborted) return { view, matched: false };
      await sleep(pollMs, signal);
    }
  }
  const showing = (view: View) => `the station shows ${view.screen ?? 'an unknown screen'}`;

  const accepted = (view: View): EffectOutcome => ({
    status: 'accepted',
    externalRef: `readback:${view.frame.digest.slice(0, 16)}`,
  });

  async function deliver(effect: Readonly<Effect>, signal: AbortSignal): Promise<EffectOutcome> {
    const procedure = procedures.get(effect.type);
    if (!procedure) return rejected('UNSUPPORTED', `No station procedure for ${effect.type}`);
    const input = effect.payload;
    if (
      procedure.hazard === 'operator-present' &&
      !resolveBinding('$input.presence.confirmedBy', input)
    )
      return rejected('PRECONDITION', `${procedure.title} needs confirmation at the station`);
    // Every binding resolves before the first action, so a bad payload never half-runs.
    for (const step of procedure.steps)
      if (step.kind === 'type' && resolveBinding(step.text, input) === undefined)
        return rejected('INVALID_PAYLOAD', `${procedure.title} is missing ${String(step.text)}`);

    attempted.add(effect.id);
    const initial = await options.control(signal);
    const blocked = blockedBy(initial, procedure);
    if (blocked) throw new DeliveryFailure(blocked);

    let view = await observe(signal);
    if (evaluate(perception, view, procedure.readback, input).met) return accepted(view);
    if (view.screen !== procedure.startScreen)
      throw new DeliveryFailure(
        `Station shows ${view.screen ?? 'an unknown screen'}; ${procedure.title} starts on ${procedure.startScreen}`,
      );
    const preconditions = evaluate(perception, view, procedure.preconditions, input);
    if (preconditions.unknown.length)
      throw new DeliveryFailure(`Cannot read ${preconditions.unknown.join(', ')} with confidence`);
    if (preconditions.unmet.length)
      return rejected(
        'PRECONDITION',
        `${procedure.title} not possible: ${preconditions.unmet.join('; ')}`,
      );

    const started = now();
    const since = view.frame.capturedAt;
    let acted = false;
    let actions = 0;
    const stop = (message: string) =>
      acted && !procedure.rerunnable
        ? new DeliveryUncertain(message)
        : new DeliveryFailure(message);

    // Re-checked before every action: seat, mode, local input, budget and deadline.
    const guard = async () => {
      if (signal.aborted) throw stop('Delivery was cancelled');
      if (now() - started > procedure.timeoutMs) throw stop(`${procedure.title} timed out`);
      if (actions >= procedure.maxSteps) throw stop(`${procedure.title} exceeded its step budget`);
      const reason = blockedBy(await options.control(signal), procedure);
      if (reason) throw stop(reason);
      if (await options.transport.localInputSince?.(since, signal))
        throw stop('Someone used the station during the procedure');
    };
    const act = async (action: ScreenAction) => {
      await guard();
      acted = true;
      touched.add(effect.id);
      await options.transport.act(action, signal);
      actions++;
    };

    const run = async (): Promise<EffectOutcome> => {
      for (const [index, step] of procedure.steps.entries()) {
        const at = `step ${index + 1} of ${procedure.steps.length}`;
        switch (step.kind) {
          case 'expect-screen': {
            view = await observe(signal);
            if (view.screen !== step.screen)
              throw stop(
                `Expected ${step.screen} at ${at}, found ${view.screen ?? 'an unknown screen'}`,
              );
            break;
          }
          case 'click': {
            const frame = await options.transport.capture(signal);
            const point =
              'region' in step.target
                ? center(step.target.region)
                : await options.driver.resolveTarget(frame, step.target, signal);
            if (!point) throw stop(`Target not found at ${at}`);
            const zone = forbiddenAt(frame, point);
            if (zone) throw stop(`Refused to act inside forbidden ${zone} at ${at}`);
            await act({ kind: 'click', point });
            break;
          }
          case 'type':
            await act({ kind: 'type', text: String(resolveBinding(step.text, input)) });
            break;
          case 'key':
            await act({ kind: 'key', key: step.key });
            break;
          case 'wait-for': {
            const { field, equals } = step;
            const fieldReady = (candidate: View) =>
              field === undefined ||
              (equals === undefined
                ? candidate.readings.has(field)
                : evaluate(perception, candidate, [{ field, equals }], input).met);
            const reached = await waitFor(
              (candidate) =>
                (step.screen === undefined || candidate.screen === step.screen) &&
                fieldReady(candidate),
              Math.min(step.timeoutMs, Math.max(0, procedure.timeoutMs - (now() - started))),
              signal,
            );
            if (!reached.matched)
              throw stop(`Timed out waiting at ${at}; ${showing(reached.view)}`);
            view = reached.view;
            break;
          }
        }
      }

      const confirmed = await waitFor(
        (candidate) => evaluate(perception, candidate, procedure.readback, input).met,
        Math.max(pollMs, procedure.timeoutMs - (now() - started)),
        signal,
      );
      if (!confirmed.matched)
        throw stop(
          `${procedure.title} ran but the station does not show the result; ${showing(confirmed.view)}`,
        );
      return accepted(confirmed.view);
    };
    try {
      return await run();
    } catch (error) {
      if (error instanceof DeliveryFailure) throw error;
      // Transport or perception broke mid-procedure. Its text may carry host details, so it is
      // replaced; whether the station changed is unknown once anything was done.
      throw stop(`${procedure.title} failed: the screen or its perception became unavailable`);
    }
  }

  /**
   * Readback of an earlier delivery. Converged: accepted. Never attempted, or attempted by this
   * process without touching the screen: deliver. Rerunnable, or back on the start screen: deliver
   * again (the earlier attempt did not stick). Anything else: uncertain, so the dispatcher holds
   * it for a person.
   */
  async function lookup(
    _effectId: string,
    signal: AbortSignal,
    effect?: Readonly<Effect>,
  ): Promise<LookupResult> {
    const procedure = effect && procedures.get(effect.type);
    if (!effect || !procedure) return undefined;
    const view = await observe(signal);
    if (evaluate(perception, view, procedure.readback, effect.payload).met) return accepted(view);
    const untouched = attempted.has(effect.id) && !touched.has(effect.id);
    if (
      effect.attempts === 0 ||
      untouched ||
      view.screen === procedure.startScreen ||
      procedure.rerunnable
    )
      return undefined;
    return {
      status: 'uncertain',
      reason: `Station shows ${view.screen ?? 'an unknown screen'} after an interrupted ${procedure.title}`,
    };
  }

  return { describe: () => ({ target, idempotentDelivery: false }), deliver, lookup };
}
