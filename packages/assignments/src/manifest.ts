import { z } from 'zod';
import {
  defineFeatureManifest,
  defineModule,
  defineTarget,
  type AnyCapability,
  type HostComponent,
} from '@agent-native/contracts';
import type { AnyAssignmentKind } from './kind';
import {
  ASSIGNMENT,
  camel,
  genericOperations,
  kindOperations,
  targetOf,
  type Camel,
} from './operations';
import { targetResultSchema } from './schemas';

/** The feature's ID: its state key, operation namespace and module ID. */
export const ASSIGNMENT_FEATURE = 'assignment';

/**
 * The journal event type of sending an assignment to agent `agentId`. An automation trigger
 * on `{ resourceType: 'assignment', operations: [<send or create>], types: [offerEventType(id)] }`
 * starts a run for each assignment sent to that agent, scoped to the assignment.
 */
export const offerEventType = (agentId: string) => `offer.${agentId}`;

/** An assignment target: the target whose feed carries offer results, with its complete, sync and status. */
export function assignmentTarget(name: string) {
  return defineTarget({
    target: targetOf(name),
    resourceType: ASSIGNMENT,
    operations: {
      complete: `assignment.${name}.complete`,
      sync: `assignment.${name}.sync`,
      status: `assignment.${name}.status`,
    },
    changes: ['assignment'],
    feed: {
      item: targetResultSchema,
      max: 50,
      changes: ['assignment', 'assignment-report'],
    },
    status: { waiting: z.number().int(), refused: z.number().int() },
    descriptions: {
      complete: `Integration principal only: record whether ${name} took an assignment offer.`,
      sync: `Integration principal only: apply the reports ${name} returned for its offers.`,
      status: `Offers waiting for ${name}, and offers it refused.`,
    },
    ui: { status: { exception: 'the assignment screens show each offer as it stands' } },
  });
}
export type AssignmentTarget = ReturnType<typeof assignmentTarget>;

type KindOperations<K extends AnyAssignmentKind> = ReturnType<typeof kindOperations<K>>;
type FlatKind<K extends AnyAssignmentKind> = {
  readonly [
    Op in keyof KindOperations<K> as `${Camel<K['id']>}${Capitalize<Op & string>}`
  ]: KindOperations<K>[Op];
};
type Intersection<U> = (U extends unknown ? (union: U) => void : never) extends (
  intersection: infer I,
) => void
  ? I
  : never;
/** The operations of every kind under `<kind>Create`, `<kind>Send`, `<kind>Report` and `<kind>Accept`. */
export type KindsOperations<K extends AnyAssignmentKind> = Intersection<
  K extends AnyAssignmentKind ? FlatKind<K> : never
>;

/** What a device or a peer application calls on the issuer as an assignee. */
export interface AssigneeOperations {
  readonly commands: readonly (AnyCapability & { readonly kind: 'command' })[];
  readonly queries: readonly (AnyCapability & { readonly kind: 'query' })[];
  /** The IDs of both, for a device's sync operations. */
  readonly operations: readonly string[];
}

/**
 * Declare an application's assignment kinds. The result holds:
 *
 * - `manifest`: the `assignment` feature manifest, for `defineManifest({ features })`;
 * - `operations`: every kind's create, send, report and accept, keyed `<kind>Create` and so on,
 *   and the generic withdraw, complete, close, list, get, feed and report operations;
 * - `targets`: one target per assignment target, named `assignment-<name>`, whose feed carries results;
 * - `assignees`: what a device and a peer may call, to merge into the device link's sync operations
 *   and the application's peer API.
 *
 * Browser-safe. The server mounts it with `assignmentFeature` from `@agent-native/assignments/server`.
 */
export function defineAssignments<const K extends AnyAssignmentKind>(spec: {
  readonly kinds: readonly K[];
  /** Host components the feature needs, such as the destination an assignment target is reached through. */
  readonly components?: readonly HostComponent[];
}) {
  const kinds = spec.kinds;
  if (kinds.length === 0) throw new Error('Assignments need at least one kind');
  const ids = kinds.map((kind) => kind.id);
  if (new Set(ids).size !== ids.length) throw new Error('Assignment kinds repeat an ID');
  const perKind = new Map(kinds.map((kind) => [kind.id, kindOperations(kind)]));
  const flat: Record<string, AnyCapability> = {};
  for (const kind of kinds)
    for (const [op, capability] of Object.entries(perKind.get(kind.id)!))
      flat[`${camel(kind.id)}${op[0]!.toUpperCase()}${op.slice(1)}`] = capability;
  const generic = genericOperations(kinds);
  const names = [...new Set(kinds.flatMap((kind) => (kind.target ? [kind.target] : [])))];
  const targets: Record<string, AssignmentTarget> = Object.fromEntries(
    names.map((name) => [name, assignmentTarget(name)]),
  );
  const operations = Object.freeze({ ...flat, ...generic }) as KindsOperations<K> & typeof generic;
  const module = defineModule({
    id: ASSIGNMENT_FEATURE,
    capabilities: [
      ...Object.values(flat),
      ...(Object.values(generic) as AnyCapability[]),
      ...Object.values(targets).flatMap((target) => target.capabilities as AnyCapability[]),
    ],
  });
  const assigneeOperations = (type: 'device' | 'peer'): AssigneeOperations => {
    const reports = kinds
      .filter((kind) => kind.assigneeTypes.includes(type))
      .map((kind) => perKind.get(kind.id)!.report);
    const commands = reports.length ? [...reports, generic.complete] : [];
    const queries = reports.length ? [generic.feed] : [];
    return Object.freeze({
      commands,
      queries,
      operations: [...commands, ...queries].map((capability) => capability.id),
    });
  };
  return Object.freeze({
    kinds,
    manifest: defineFeatureManifest({
      id: ASSIGNMENT_FEATURE,
      title: 'Assignments',
      modules: [module],
      ...(spec.components ? { components: spec.components } : {}),
    }),
    module,
    operations,
    targets,
    assignees: Object.freeze({
      device: assigneeOperations('device'),
      peer: assigneeOperations('peer'),
    }),
  });
}
export type Assignments<K extends AnyAssignmentKind = AnyAssignmentKind> = ReturnType<
  typeof defineAssignments<K>
>;
