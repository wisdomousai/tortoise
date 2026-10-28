import {
  approvalFeatureManifest,
  approvalOperations,
  type AnyCapability,
  type ApprovalRequest,
} from '@agent-native/contracts';
import { approvalHandlers } from './approval.js';
import { own } from './collection.js';
import type { FeatureHandlerContext, FeatureServer } from './feature.js';
import { isDelegated } from './policy.js';
import type { Decision, ExecutionContext, HandlerContext } from './types.js';

/** What a caller does with approval requests; `read` covers list, get and journal events. */
export type ApprovalAction = 'request' | 'approve' | 'reject' | 'expire' | 'read';

/**
 * The application's decision on who may do what with approval requests. The approval feature's
 * policy and handlers ask only this; the application's own policy never sees approval
 * operations, so `allows` must apply the application's membership gate, its integration
 * principals' allowlists and a delegated grant's resource scope itself.
 */
export interface ApprovalAccess {
  /**
   * Whether `context` may take `action` on approval requests about `resource`, the record an
   * approval request names. Without `resource`: whether it may take the action on an approval
   * request that names no record, and for `read`, whether it may list approval requests at all.
   * An approval request shows the requested input, so let whoever may see that record read it.
   */
  allows(context: ExecutionContext, action: ApprovalAction, resource?: string): boolean;
}

/** Application code the approval feature calls; each defaults when the application omits it. */
export interface ApprovalHooks {
  /** A new approval request ID; `crypto.randomUUID()` when omitted. */
  newId?(): string;
  /** The current time in milliseconds; `Date.now()` when omitted. */
  now?(): number;
  /**
   * Check a requested command's input against the application's records when the approval
   * request is submitted; throw `INVALID_INPUT` to refuse it. Every request passes when omitted.
   */
  request?(operation: string, input: unknown): void;
}

/** The approval feature's state slice, under `approval` in the application's state. */
export interface ApprovalSlice {
  readonly requests: Record<string, ApprovalRequest>;
}

export interface ApprovalFeatureOptions {
  /** How long an approval request stays pending; 24 hours when omitted. */
  readonly ttlMs?: number;
  /**
   * Commands an approval may be requested for. Default: every command of the application's own
   * modules. Approval operations are never eligible.
   */
  readonly commands?: readonly AnyCapability[];
}

type Context = FeatureHandlerContext<ApprovalSlice, unknown, ApprovalAccess, ApprovalHooks>;
const ALLOW: Decision = { allowed: true };
const deny = (reason: string): Decision => ({ allowed: false, reason });
const ops = approvalOperations;
const decidedBy: Readonly<Record<string, ApprovalAction>> = {
  [ops.approvalApprove.id]: 'approve',
  [ops.approvalReject.id]: 'reject',
  [ops.approvalExpire.id]: 'expire',
  [ops.approvalGet.id]: 'read',
};

/** One snapshot's decision: the slice and the access view computed from the same state. */
function decide(
  capability: AnyCapability,
  input: Record<string, unknown>,
  context: ExecutionContext,
  slice: ApprovalSlice,
  access: ApprovalAccess,
): boolean {
  const id = capability.id;
  if (id === ops.approvalRequest.id)
    return access.allows(context, 'request', input.resource as string | undefined);
  if (id === ops.approvalList.id) return access.allows(context, 'read');
  const approval = own(slice.requests, String(input.id));
  // A request the caller cannot see passes on the list gate alone; the handler then reports it
  // missing, so a refusal never confirms that a hidden approval request exists.
  if (!approval || !access.allows(context, 'read', approval.resource))
    return access.allows(context, 'read');
  return access.allows(context, decidedBy[id]!, approval.resource);
}

/**
 * Approval requests as a feature: an agent or person asks for a command, and a person approves,
 * which runs the command under the approver in the same transaction, or rejects it. The slice
 * keeps the requests; the application supplies `ApprovalAccess` and, optionally, ID, clock
 * and request-check hooks. Approve and reject are person-only for every application.
 */
export function approvalFeature(
  options: ApprovalFeatureOptions = {},
): FeatureServer<ApprovalSlice, ApprovalAccess, ApprovalHooks> {
  return {
    manifest: approvalFeatureManifest,
    state: { create: () => ({ requests: {} }) },
    handlers: (composition) =>
      approvalHandlers<ApprovalSlice, unknown>({
        store: (slice) => slice.requests,
        commands:
          options.commands ??
          composition.applicationModules.flatMap((module) =>
            module.capabilities.filter((capability) => capability.kind === 'command'),
          ),
        visible: (approval, ctx) =>
          (ctx as Context).access.allows(ctx.context, 'read', approval.resource),
        newId: (ctx: HandlerContext<ApprovalSlice, unknown>) =>
          (ctx as Context).hooks.newId?.() ?? crypto.randomUUID(),
        now: (ctx: HandlerContext<ApprovalSlice, unknown>) =>
          (ctx as Context).hooks.now?.() ?? Date.now(),
        check: (operation, input, ctx) => (ctx as Context).hooks.request?.(operation, input),
        ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
      }),
    authorization: {
      resourceTypes: ['approval-request'],
      port: {
        authorize({ capability, input, context, state, access, previousState, previousAccess }) {
          const id = capability.id;
          if (
            (id === ops.approvalApprove.id || id === ops.approvalReject.id) &&
            isDelegated(context)
          )
            return deny('PERSON_ONLY');
          const fields = (input ?? {}) as Record<string, unknown>;
          const allowed =
            decide(capability, fields, context, state, access) &&
            (previousState === undefined ||
              previousAccess === undefined ||
              decide(capability, fields, context, previousState, previousAccess));
          return allowed ? ALLOW : deny('RESOURCE_DENIED');
        },
        canReadEvent({ event, state, context, access }) {
          const approval = own(state.requests, event.resource.slice('approval-request:'.length));
          return !!approval && access.allows(context, 'read', approval.resource);
        },
      },
    },
  };
}
