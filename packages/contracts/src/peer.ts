import type { AnyCapability } from './capability';

type Commands = readonly (AnyCapability & { readonly kind: 'command' })[];
type Queries = readonly (AnyCapability & { readonly kind: 'query' })[];

/**
 * What another application may call here over a peer link, as declared by the application that
 * is called. Browser-safe data: the callee's peer link grants from it, and a caller imports it
 * to type its effects and reads.
 *
 * - `commands` and `queries` run as the peer's service principal, `peer:<id>`, which no person
 *   is mapped to.
 * - `onBehalfOf` runs as the person the peer's signed subject is mapped to here, under that
 *   person's own policy.
 */
export interface PeerSurface<
  C extends Commands = Commands,
  Q extends Queries = Queries,
  OC extends Commands = Commands,
  OQ extends Queries = Queries,
> {
  /** The ID of the application that serves the surface. */
  readonly application: string;
  readonly commands: C;
  readonly queries: Q;
  readonly onBehalfOf: { readonly commands: OC; readonly queries: OQ };
  /** IDs a service principal may call. */
  readonly serviceOperations: readonly string[];
  /** IDs a call on behalf of a person may call. */
  readonly onBehalfOfOperations: readonly string[];
}

/**
 * Declare a peer surface. It refuses an operation of the wrong kind, a command listed both for
 * the service principal and on behalf of a person (a delivery would not know whose it is), and
 * on behalf of a person a command that takes blobs: a peer cannot upload as the person.
 */
export function definePeerSurface<
  const C extends Commands = readonly [],
  const Q extends Queries = readonly [],
  const OC extends Commands = readonly [],
  const OQ extends Queries = readonly [],
>(spec: {
  readonly application: string;
  readonly commands?: C;
  readonly queries?: Q;
  readonly onBehalfOf?: { readonly commands?: OC; readonly queries?: OQ };
}): PeerSurface<C, Q, OC, OQ> {
  const fail = (message: string): never => {
    throw new Error(`Peer surface of ${spec.application} ${message}`);
  };
  const commands = (spec.commands ?? []) as C;
  const queries = (spec.queries ?? []) as Q;
  const onBehalfOf = {
    commands: (spec.onBehalfOf?.commands ?? []) as OC,
    queries: (spec.onBehalfOf?.queries ?? []) as OQ,
  };
  for (const [list, kind] of [
    [commands, 'command'],
    [queries, 'query'],
    [onBehalfOf.commands, 'command'],
    [onBehalfOf.queries, 'query'],
  ] as const)
    for (const capability of list as readonly AnyCapability[])
      if (capability.kind !== kind) fail(`lists ${capability.id} as a ${kind}`);
  const service = new Set(commands.map((capability) => capability.id));
  for (const capability of onBehalfOf.commands) {
    if (service.has(capability.id))
      fail(`lists ${capability.id} for the service principal and on behalf of a person`);
    if (capability.blobs) fail(`cannot take blobs on behalf of a person in ${capability.id}`);
  }
  const ids = (lists: readonly (readonly AnyCapability[])[]) => [
    ...new Set(lists.flatMap((list) => list.map((capability) => capability.id))),
  ];
  return Object.freeze({
    application: spec.application,
    commands,
    queries,
    onBehalfOf: Object.freeze(onBehalfOf),
    serviceOperations: ids([commands, queries]),
    onBehalfOfOperations: ids([onBehalfOf.commands, onBehalfOf.queries]),
  });
}

/** Every operation a peer surface lists, once each. */
export const peerSurfaceOperations = (surface: PeerSurface): readonly AnyCapability[] => [
  ...new Map(
    [
      ...surface.commands,
      ...surface.queries,
      ...surface.onBehalfOf.commands,
      ...surface.onBehalfOf.queries,
    ].map((capability) => [capability.id, capability as AnyCapability]),
  ).values(),
];
