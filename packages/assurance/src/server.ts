import {
  ApplicationError,
  type AnyCapability,
  type InputOf,
  type OutputOf,
} from '@agent-native/contracts';
import type {
  AuthorizationPort,
  AuthorizationRoute,
  HandlerContext,
  HandlerContribution,
} from '@agent-native/runtime';
import { assuranceModule, assuranceOperations } from './contracts';
import type { AssurancePort } from './monitor';

/** Who may read the audit trail. Owned by the composing application's state. */
export interface AssuranceState {
  auditors: string[];
}
export function createAssuranceState(auditors: readonly string[]): AssuranceState {
  return { auditors: [...auditors] };
}
/** Host services the handlers read. Absent in hosts without an audit log. */
export interface AssuranceServices {
  readonly assurance?: AssurancePort;
}

type Context = HandlerContext<AssuranceState, AssuranceServices>;
function handler<C extends AnyCapability>(
  capability: C,
  handle: (input: InputOf<C>, ctx: Context) => Promise<OutputOf<C>>,
): HandlerContribution<AssuranceState, AssuranceServices, C> {
  return { capability, handle };
}
const port = (ctx: Context) => {
  if (!ctx.services.assurance)
    throw new ApplicationError('UNAVAILABLE', 'This host has no audit log to report on');
  return ctx.services.assurance;
};

/**
 * Query handlers over the host's posture monitor. They read files and host memory, never
 * workspace state, so they change nothing and need no transaction beyond authorization.
 */
export function createAssuranceHandlers(): HandlerContribution<
  AssuranceState,
  AssuranceServices
>[] {
  return [
    handler(assuranceOperations.postureGet, async (_input, ctx) => port(ctx).posture()),
    handler(assuranceOperations.eventsList, async (input, ctx) => port(ctx).events(input)),
    handler(assuranceOperations.logVerify, async (_input, ctx) => port(ctx).verify()),
  ];
}

const knownOperations = new Set<string>(assuranceModule.capabilities.map((item) => item.id));

/**
 * Only named auditors read the audit trail. A delegated grant must list the operation (the
 * runtime checks that) and, when it is resource-limited, name `audit:log`, so an agent run
 * scoped to business records cannot read the log by accident.
 */
export const assurancePolicy: AuthorizationPort<AssuranceState> = {
  authorize({ capability, context, state }) {
    if (!knownOperations.has(capability.id)) return { allowed: false, reason: 'NO_POLICY' };
    if (context.grant?.resources && !context.grant.resources.includes('audit:log'))
      return { allowed: false, reason: 'RESOURCE_DENIED' };
    return { allowed: state.auditors.includes(context.principalId), reason: 'RESOURCE_DENIED' };
  },
  // The module emits no change events; nothing to disclose.
  canReadEvent: () => false,
};

/** Authorization route for composing the module over a state slice. */
export function assuranceAuthorizationRoute<Root>(
  select: (state: Root) => AssuranceState,
): AuthorizationRoute<Root> {
  return {
    module: assuranceModule,
    resourceTypes: ['audit'],
    select,
    port: assurancePolicy as AuthorizationPort<unknown>,
  };
}

export { assuranceModule, assuranceOperations } from './contracts';
