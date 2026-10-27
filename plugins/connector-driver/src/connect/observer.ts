import { createHash } from 'node:crypto';
import {
  clampConfidence,
  createObserver,
  debounceReadings,
  Debouncer,
  type DeviceIdentity,
  type ObservationBase,
  type ObserverOptions,
  type Reading,
} from '@agent-native/observation';
import { stateValueFits, type DriverContract } from '../contracts/define';
import type { DriverSupervisor } from '../supervisor';

/** One sample of a driver's state, gated, with the session it came from. */
export interface DriverObservation extends ObservationBase {
  readonly driver: string;
  /** The driver session that replied; a restart starts a new one and restarts every count. */
  readonly session: string;
}

export interface DriverObserverOptions extends Omit<
  ObserverOptions<DriverObservation>,
  'source' | 'sample'
> {
  readonly contract: DriverContract;
  readonly supervisor: Pick<DriverSupervisor, 'read' | 'status'>;
  /** The state fields to sample; defaults to all. */
  readonly fields?: readonly string[];
  readonly now?: () => number;
}

/**
 * Watches one driver's state through `state.read` and reports it through the application's
 * ingest command, like the screen observer reports a screen. It never acts on the equipment.
 *
 * - Each reading carries the device the driver reported at its handshake (driver id and version,
 *   the first unit's serial and firmware), so a value traces to a physical unit.
 * - `observedAt` is the host's clock; the driver's own time is not trusted.
 * - A value that does not match its declared type or options is read as `null` with confidence
 *   0, so it reaches the domain as uncertain, never as fact.
 * - Fields need their `stableReads` agreeing reads within one session; a new session restarts
 *   every count, because a restarted driver's earlier reads say nothing about the unit now.
 */
export function createDriverObserver(options: DriverObserverOptions) {
  const { contract, supervisor } = options;
  const fields = options.fields ?? Object.keys(contract.state);
  for (const field of fields)
    if (!contract.state[field]) throw new Error(`Driver ${contract.id} has no state ${field}`);
  const now = options.now ?? Date.now;
  let debouncer = new Debouncer();
  let gateSession: string | undefined;

  async function sample(signal: AbortSignal): Promise<DriverObservation> {
    const result = await supervisor.read(fields, signal);
    const status = supervisor.status();
    const session = status.session ?? 'none';
    if (session !== gateSession) {
      debouncer = new Debouncer();
      gateSession = session;
    }
    const unit = status.devices[0];
    const device: DeviceIdentity = {
      driver: status.driver?.id ?? contract.id,
      ...(status.driver ? { driverVersion: status.driver.version } : {}),
      ...(unit?.serial ? { serial: unit.serial } : {}),
      ...(unit?.firmware ? { firmware: unit.firmware } : {}),
    };
    const observedAt = now();
    const frameDigest = createHash('sha256')
      .update(JSON.stringify({ session, values: result.values }))
      .digest('hex');
    const readings: Reading[] = fields
      .filter((field) => field in result.values)
      .map((field) => {
        const value = result.values[field]!;
        const valid = stateValueFits(contract.state[field]!, value);
        return {
          field,
          value: valid ? value : null,
          confidence: valid ? clampConfidence(result.confidence[field] ?? 1) : 0,
          extractor: `driver.${contract.id}`,
          device,
          observedAt,
          frameDigest,
        };
      });
    return {
      driver: contract.id,
      session,
      observedAt,
      frameDigest,
      readings: debounceReadings(debouncer, readings, (id) => {
        const declared = contract.state[id];
        return declared
          ? {
              stableReads: declared.stableReads ?? 1,
              minConfidence: declared.minConfidence ?? 1,
              declared,
            }
          : undefined;
      }),
    };
  }

  const {
    contract: _contract,
    supervisor: _supervisor,
    fields: _fields,
    now: _now,
    ...rest
  } = options;
  return createObserver<DriverObservation>({ ...rest, source: `driver.${contract.id}`, sample });
}
