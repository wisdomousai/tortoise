import type { AuthorizationPort, HandlerContext, HandlerContribution } from '@agent-native/runtime';
import { driverModule, driverOperations } from './contracts/status';
import { driverServiceOf } from './open';

/** Who may read driver status. Created with the workspace owner. */
export interface DriverState {
  readers: string[];
}
export function createDriverState(readers: readonly string[]): DriverState {
  return { readers: [...readers] };
}

type Context = HandlerContext<DriverState, Readonly<Record<string, unknown>>>;

/** The status query reads the supervisors in host memory, never workspace state. */
export function createDriverHandlers(): HandlerContribution<
  DriverState,
  Readonly<Record<string, unknown>>
>[] {
  return [
    {
      capability: driverOperations.statusGet,
      handle: async (_input: unknown, ctx: Context) => ({
        drivers: driverServiceOf(ctx.services).status(),
      }),
    },
  ];
}

const knownOperations = new Set<string>(driverModule.capabilities.map((item) => item.id));

/**
 * Named readers see driver status. A resource-limited delegated grant must name `driver:status`,
 * so an agent run scoped to business records does not read equipment identities by accident.
 * Acting on equipment is never this plugin's operation: it goes through the application's own
 * commands and the outbox.
 */
export const driverPolicy: AuthorizationPort<DriverState> = {
  authorize({ capability, context, state }) {
    if (!knownOperations.has(capability.id)) return { allowed: false, reason: 'NO_POLICY' };
    if (context.grant?.resources && !context.grant.resources.includes('driver:status'))
      return { allowed: false, reason: 'RESOURCE_DENIED' };
    return { allowed: state.readers.includes(context.principalId), reason: 'RESOURCE_DENIED' };
  },
  // The module emits no change events.
  canReadEvent: () => false,
};
