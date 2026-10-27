import type { SystemOfRecordPort } from '@agent-native/integration';
import type { ComputerUseDriver, Extractor, ScreenTransport } from './ports';
import type { StationProfile } from './profile';
import { createControllerKernel } from './controller/kernel';
import { deliver } from './controller/deliver';
import { lookup } from './controller/lookup';

/**
 * Bridge state the controller obeys, read from the application through the bridge principal's
 * control query before every action. `monitor-only` never acts; `assist` runs only
 * procedures of risk level `none`; `actuate` runs every declared procedure. Whoever holds control owns the screen.
 */
export interface BridgeControl {
  readonly mode: 'monitor-only' | 'assist' | 'actuate';
  readonly holder: 'operator' | 'agent' | 'idle';
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

/**
 * Executes outbox effects on station software through its screen: the outbound half of the
 * bridge, used as an ordinary `SystemOfRecordPort` behind the effect dispatcher. Each effect type
 * maps to a declared procedure of the station profile; nothing else can be done.
 *
 * Guarantees, in order:
 * 1. Nothing runs unless the bridge mode allows the procedure's risk level and the operator does not
 *    hold control. A blocked effect stays pending (transient failure) and is retried later.
 * 2. If the screen already shows the desired state, the effect is accepted without acting
 *    (convergence makes screen actions idempotent).
 * 3. Unmet preconditions reject the effect as business data (`PRECONDITION`); nothing is done.
 * 4. Before every click, type and key action the control state and local input are checked again,
 *    the screen the procedure expects at that point is verified on a fresh capture (for a click, the
 *    capture its target was resolved on), and the resolved point is refused inside any forbidden
 *    region.
 * 5. Acceptance is a readback: observed values matching the request on as many consecutive views
 *    as the fields' `stableReads` require, never "the clicks worked" or one transient reading. The
 *    same standard applies to convergence, preconditions and lookup.
 * 6. Once anything was done, an interruption is `DeliveryUncertain` (held for a person to
 *    reconcile) unless the procedure is declared `rerunnable`.
 */
export function createStationConnector(options: StationConnectorOptions): SystemOfRecordPort {
  const target = options.target ?? 'legacy-hmi';
  const kernel = createControllerKernel(options);
  return {
    describe: () => ({ target, idempotentDelivery: false }),
    deliver: (effect, signal) => deliver(kernel, effect, signal),
    lookup: (_effectId, signal, effect) => lookup(kernel, signal, effect),
  };
}
