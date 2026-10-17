import type {
  Availability,
  DeviceRequirement,
  JsonValue,
  NetworkDestination,
  Schema,
} from '@agent-native/contracts';

/**
 * How a host keeps a driver action from acting twice:
 * - `idempotent`: the driver deduplicates by effect ID, so a retry is always safe;
 * - `convergent`: the host reads the declared `readback` before and after acting, so a target
 *   that already shows the result is accepted without acting;
 * - `once`: the driver answers `action.lookup` for an effect ID, and an unknown outcome is held.
 */
export type DeliveryMode = 'idempotent' | 'convergent' | 'once';

/**
 * What an action can do to people or equipment. `none` runs in `assist` mode; `low` needs
 * `actuate`; `operator-present` needs `actuate` and a person who confirmed at the machine.
 */
export type HazardClass = 'none' | 'low' | 'operator-present';

/** One value the driver reports in `state.read` and telemetry. */
export interface DriverStateField {
  readonly type: 'number' | 'text' | 'enum' | 'boolean';
  readonly unit?: string;
  readonly decimals?: number;
  readonly options?: readonly string[];
  /** Consecutive agreeing reads before a value counts. Defaults to 1. */
  readonly stableReads?: number;
  /** Drivers report instrument confidence; readings below this become uncertain. Defaults to 1. */
  readonly minConfidence?: number;
}

/**
 * A condition on driver state. `equals` and `in` take literals or `$input.<path>` bindings into
 * the action input, so a readback can say "the setpoint equals the requested one".
 */
export interface DriverCondition {
  readonly field: string;
  readonly equals?: JsonValue;
  readonly in?: readonly JsonValue[];
}

export interface DriverAction {
  readonly title: string;
  readonly input: Schema<unknown>;
  readonly result?: Schema<unknown>;
  readonly delivery: DeliveryMode;
  readonly hazard: HazardClass;
  /** How long the action may run before the host stops waiting and treats it as interrupted. */
  readonly timeoutMs: number;
  /** What the state shows once the action took effect. Required for `convergent`. */
  readonly readback?: readonly DriverCondition[];
  /** What must hold before the action runs; unmet ones reject the effect. */
  readonly preconditions?: readonly DriverCondition[];
}

/**
 * Something the driver reports on its own. `telemetry` carries state fields and enters as
 * observations, no faster than `maxRateHz`; `occurrence` is a discrete happening such as an
 * alarm or a pedal press; `progress` reports a running action.
 */
export interface DriverEvent {
  readonly kind: 'telemetry' | 'occurrence' | 'progress';
  readonly payload?: Schema<unknown>;
  readonly maxRateHz?: number;
}

/** The driver executable, as the process requirement the site policy binds. */
export interface DriverProcessDeclaration {
  readonly id: string;
  readonly purpose: string;
  readonly availability: Availability;
  /** Destinations the driver reaches itself, such as a controller on the plant network. */
  readonly network?: readonly string[];
  /** Environment variables from the secret store, such as a vendor licence. Names only. */
  readonly secrets?: readonly string[];
}

/**
 * Browser-safe description of one driver: its state, actions and events, and what it needs from
 * the deployment. The host checks a running driver against it at every handshake by digest.
 */
export interface DriverContract {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly process: DriverProcessDeclaration;
  readonly devices?: readonly DeviceRequirement[];
  readonly network?: readonly NetworkDestination[];
  readonly state: Readonly<Record<string, DriverStateField>>;
  readonly actions: Readonly<Record<string, DriverAction>>;
  readonly events?: Readonly<Record<string, DriverEvent>>;
  /**
   * The state field that says who controls the equipment, and the value meaning its own panel
   * does. While it shows `local`, remote actions are refused, as the screen bridge refuses while
   * the operator holds the seat.
   */
  readonly control?: { readonly field: string; readonly local: string };
  /** The driver answers `action.lookup`. Required by any `once` action. */
  readonly lookup?: boolean;
}

const idPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

function checkConditions(
  contract: DriverContract,
  owner: string,
  conditions: readonly DriverCondition[] | undefined,
) {
  for (const condition of conditions ?? []) {
    if (!contract.state[condition.field])
      throw new Error(`Driver ${contract.id} ${owner} names undeclared state ${condition.field}`);
    if ((condition.equals === undefined) === (condition.in === undefined))
      throw new Error(`Driver ${contract.id} ${owner} needs exactly one of equals or in`);
  }
}

/**
 * Validate and freeze a driver contract. Throws on the first problem, naming the driver and the
 * declaration: malformed IDs, a `convergent` action without readback, a `once` action on a
 * driver without lookup, a condition or control field that is not declared state, or a
 * non-positive timeout or rate.
 */
export function defineDriverContract<const C extends DriverContract>(contract: C): C {
  for (const id of [contract.id, contract.process.id])
    if (!idPattern.test(id)) throw new Error(`Invalid driver or process id ${id}`);
  for (const [name, action] of Object.entries(contract.actions)) {
    if (!idPattern.test(name)) throw new Error(`Driver ${contract.id} has invalid action ${name}`);
    if (!(action.timeoutMs > 0))
      throw new Error(`Driver ${contract.id} action ${name} needs a positive timeout`);
    if (action.delivery === 'convergent' && !action.readback?.length)
      throw new Error(`Driver ${contract.id} action ${name} is convergent without a readback`);
    if (action.delivery === 'once' && !contract.lookup)
      throw new Error(`Driver ${contract.id} action ${name} is once, but the driver has no lookup`);
    checkConditions(contract, `action ${name}`, action.readback);
    checkConditions(contract, `action ${name}`, action.preconditions);
  }
  for (const [name, event] of Object.entries(contract.events ?? {}))
    if (event.maxRateHz !== undefined && !(event.maxRateHz > 0))
      throw new Error(`Driver ${contract.id} event ${name} needs a positive maxRateHz`);
  if (contract.control && !contract.state[contract.control.field])
    throw new Error(
      `Driver ${contract.id} control names undeclared state ${contract.control.field}`,
    );
  return Object.freeze(contract);
}
