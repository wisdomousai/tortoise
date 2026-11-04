import {
  ApplicationError,
  type AnyCapability,
  type InputOf,
  type OutputOf,
} from '@tortoise/contracts';
import type { AuthorizationPort, HandlerContext, HandlerContribution } from '@tortoise/runtime';
import { complianceModule, complianceOperations } from './contracts';
import type { CompliancePort } from './monitor';

/** Who may read the audit trail. Owned by the composing application's state. */
export interface ComplianceState {
  auditors: string[];
}
export function createComplianceState(auditors: readonly string[]): ComplianceState {
  return { auditors: [...auditors] };
}
/** Host services the handlers read. Absent in hosts without an audit log. */
export interface ComplianceServices {
  readonly compliance?: CompliancePort;
}

type Context = HandlerContext<ComplianceState, ComplianceServices>;
function handler<C extends AnyCapability>(
  capability: C,
  handle: (input: InputOf<C>, ctx: Context) => Promise<OutputOf<C>>,
): HandlerContribution<ComplianceState, ComplianceServices, C> {
  return { capability, handle };
}
const port = (ctx: Context) => {
  if (!ctx.services.compliance)
    throw new ApplicationError('UNAVAILABLE', 'This host has no audit log to report on');
  return ctx.services.compliance;
};

/**
 * Query handlers over the host's compliance monitor. They read files and host memory, never
 * workspace state, so they change nothing and need no transaction beyond authorization.
 */
export function createComplianceHandlers(): HandlerContribution<
  ComplianceState,
  ComplianceServices
>[] {
  return [
    handler(complianceOperations.statusGet, async (_input, ctx) => port(ctx).status()),
    handler(complianceOperations.eventsList, async (input, ctx) => port(ctx).events(input)),
    handler(complianceOperations.logVerify, async (_input, ctx) => port(ctx).verify()),
  ];
}

const knownOperations = new Set<string>(complianceModule.capabilities.map((item) => item.id));

/**
 * Only named auditors read the audit trail. A delegated grant must list the operation (the
 * runtime checks that) and, when it is resource-limited, name `audit:log`, so an agent run
 * scoped to business records cannot read the log by accident.
 */
export const compliancePolicy: AuthorizationPort<ComplianceState> = {
  authorize({ capability, context, state }) {
    if (!knownOperations.has(capability.id)) return { allowed: false, reason: 'NO_POLICY' };
    if (context.grant?.resources && !context.grant.resources.includes('audit:log'))
      return { allowed: false, reason: 'RESOURCE_DENIED' };
    return { allowed: state.auditors.includes(context.principalId), reason: 'RESOURCE_DENIED' };
  },
  // The module emits no change events; nothing to disclose.
  canReadEvent: () => false,
};

export { complianceModule, complianceOperations } from './contracts';
