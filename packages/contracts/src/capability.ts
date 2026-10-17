import type { AgentDefinition } from './agent';
import type { BlobLimits } from './blob';
import type { Schema } from './schema';
import type { Requirements } from './requirements';

export interface PermissionRequirement {
  readonly action: string;
  readonly resourceType: string;
  readonly fields?: readonly string[];
}
/**
 * Declares that a command's committed result is forwarded to an external system of record through
 * the transactional outbox. A receipt proves the local commit only; acceptance by `target` arrives
 * later through a settlement command and may be a rejection.
 */
export interface IntegrationDeclaration {
  readonly target: string;
  readonly delivery: 'outbox';
}
/**
 * Declares that a query reads another system at call time instead of local state. The
 * runtime calls the target's source outside any transaction, after authorizing the caller, and
 * returns the items with the source's status and fetch time; nothing is stored. A source that
 * cannot be reached yields `unavailable`, never an error that hides local data.
 */
export interface RemoteReadDeclaration {
  readonly target: string;
  /**
   * `caller`: the source must act with the caller's own credential in the target, so the target's
   * sharing rules apply. `caller-or-service`: it may fall back to a service credential when the
   * caller has none. Local policy projects the rows in both cases.
   */
  readonly identity: 'caller' | 'caller-or-service';
}
export interface Capability<
  Id extends string = string,
  Kind extends 'command' | 'query' = 'command' | 'query',
  Input = unknown,
  Output = unknown,
> {
  readonly id: Id;
  readonly kind: Kind;
  readonly input: Schema<Input>;
  readonly output: Schema<Output>;
  readonly description?: string;
  readonly permission: PermissionRequirement;
  readonly dependencies?: readonly string[];
  readonly ui?: { readonly binding?: string; readonly exception?: string };
  readonly errors?: readonly string[];
  readonly integration?: IntegrationDeclaration;
  /** Queries only: read `target` at call time. See `RemoteReadDeclaration`. */
  readonly remote?: RemoteReadDeclaration;
  /**
   * Top-level input fields that are safe to record in the event log in plain text. Everything
   * else is logged only as a digest; never list credentials, personal data or free text here.
   */
  readonly audit?: { readonly fields?: readonly string[] };
  /**
   * Commands only: the blobs this command may attach to the resources it changes. A command
   * without it cannot attach blobs. See `BlobLimits`.
   */
  readonly blobs?: BlobLimits;
}
export type AnyCapability = Capability<string, 'command' | 'query', unknown, unknown>;
export type InputOf<C> =
  C extends Capability<string, 'command' | 'query', infer I, unknown> ? I : never;
export type OutputOf<C> =
  C extends Capability<string, 'command' | 'query', unknown, infer O> ? O : never;
export function defineCapability<
  const Id extends string,
  const Kind extends 'command' | 'query',
  I,
  O,
>(capability: Capability<Id, Kind, I, O>): Capability<Id, Kind, I, O> {
  return Object.freeze(capability);
}
export interface CapabilityModule<C extends readonly AnyCapability[] = readonly AnyCapability[]> {
  readonly id: string;
  readonly capabilities: C;
  readonly requires?: readonly string[];
  /** Network destinations, devices and child processes this module needs. See `Requirements`. */
  readonly requirements?: Requirements;
  readonly workflows?: readonly {
    readonly id: string;
    readonly operations: readonly string[];
    readonly text: string;
  }[];
  /** Agents that work with this module's operations. See `defineAgent`. */
  readonly agents?: readonly AgentDefinition[];
}
export function defineModule<const C extends readonly AnyCapability[]>(
  module: CapabilityModule<C>,
): CapabilityModule<C> {
  return Object.freeze(module);
}
export type CapabilitiesOf<M extends readonly CapabilityModule[]> =
  M[number]['capabilities'][number];
export type CapabilityById<C extends AnyCapability, Id extends C['id']> = Extract<C, { id: Id }>;
