import type { z } from 'zod';
import type { AnyCapability, InputOf } from './capability';
import { ApplicationError } from './errors';
import type { JsonValue } from './json';
import type { PeerApi } from './peer';
import type {
  Availability,
  NetworkDestination,
  NetworkScope,
  OfflineBehavior,
} from './requirements';
import { defineHostComponent } from './requirements';
import { defineTarget, type TargetSpec } from './target';

type SurfaceCommand<S extends PeerApi> =
  S['commands'][number] | S['onBehalfOf']['commands'][number];

/** The effect a command enqueues for a peer: the peer command's ID as type, its input as payload. */
export interface PeerEffectRequest {
  readonly target: string;
  readonly type: string;
  readonly resource: string;
  readonly payload: JsonValue;
}

/**
 * Declare another agent-native application as an outbox target, through the peer API it
 * publishes. Besides the target's complete, sync and status operations it gives:
 *
 * - `destination`: an `https`, `authenticated` egress destination that carries the target and
 *   its remote reads, and `component`, a host component requiring it, for the manifest's
 *   `components`;
 * - `effect(command, { resource, payload })`: the effect request for one api command, with
 *   the payload parsed by the command's own input schema, so a payload the peer would refuse
 *   fails the enqueuing command instead;
 * - `onBehalfOf(type)`: whether an effect is delivered as the person who enqueued it rather than
 *   as the peer's service principal;
 * - `feed`, when given: a service query of the API that returns `{ items, cursor, more? }`.
 *
 * Browser-safe. The server pairs it with `connectPeerTarget` from `@tortoise/integration`.
 */
export function definePeerTarget<
  const S extends PeerApi,
  const Target extends string,
  const Complete extends string = `${Target}.effect.complete`,
  const Sync extends string = `${Target}.sync`,
  const Status extends string = `${Target}.sync.status`,
  Item extends z.ZodType = z.ZodNever,
  Extra extends z.ZodRawShape = {},
  StatusShape extends z.ZodRawShape = {},
>(
  spec: Omit<TargetSpec<Target, Complete, Sync, Status, Item, Extra, StatusShape>, 'feed'> & {
    readonly api: S;
    readonly destination: {
      readonly id: string;
      readonly purpose: string;
      readonly scope?: NetworkScope;
      readonly port?: number;
      readonly dataClasses: readonly string[];
      readonly availability: Availability;
      readonly offline: OfflineBehavior;
    };
    readonly feed?: NonNullable<
      TargetSpec<Target, Complete, Sync, Status, Item, Extra, StatusShape>['feed']
    > & { readonly query: S['queries'][number] };
    /** Whether data providers read this target through the peer; adds it to the destination's reads. */
    readonly reads?: boolean;
  },
) {
  const { api, destination: declared, reads, ...target } = spec;
  if (spec.feed && !api.queries.some((query) => query.id === spec.feed!.query.id))
    throw new Error(
      `Peer target ${spec.target} feeds from ${spec.feed.query.id}, not a service query`,
    );
  const defined = defineTarget<Target, Complete, Sync, Status, Item, Extra, StatusShape>(
    target as TargetSpec<Target, Complete, Sync, Status, Item, Extra, StatusShape>,
  );
  const commands = new Map<string, AnyCapability>(
    [...api.commands, ...api.onBehalfOf.commands].map((command) => [command.id, command]),
  );
  const personal = new Set(api.onBehalfOf.commands.map((command) => command.id));
  const destination: NetworkDestination = {
    id: declared.id,
    purpose: declared.purpose,
    direction: 'egress',
    scope: declared.scope ?? 'local',
    protocol: 'https',
    ...(declared.port === undefined ? {} : { port: declared.port }),
    authenticated: true,
    targets: [spec.target],
    ...(reads ? { reads: [spec.target] } : {}),
    dataClasses: declared.dataClasses,
    availability: declared.availability,
    offline: declared.offline,
  };
  return Object.freeze({
    ...defined,
    api,
    destination,
    component: defineHostComponent({
      id: `${spec.target}-peer`,
      description: `${api.application}, called as a peer: ${declared.purpose}`,
      requirements: { network: [destination] },
    }),
    feedQuery: spec.feed?.query.id,
    onBehalfOf: (type: string) => personal.has(type),
    effect<C extends SurfaceCommand<S>>(
      command: C,
      request: { readonly resource: string; readonly payload: InputOf<C> },
    ): PeerEffectRequest {
      const known = commands.get(command.id);
      if (!known)
        throw new ApplicationError(
          'INTERNAL',
          `${command.id} is not on the peer API of ${api.application}`,
        );
      let payload: JsonValue;
      try {
        payload = known.input.parse(request.payload) as JsonValue;
      } catch {
        throw new ApplicationError(
          'INVALID_INPUT',
          `The record does not make valid input for ${command.id} on ${api.application}`,
        );
      }
      return { target: spec.target, type: command.id, resource: request.resource, payload };
    },
  });
}
export type PeerTarget = ReturnType<typeof definePeerTarget>;
