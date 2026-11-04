import {
  ApplicationError,
  approvalOperations,
  approvals,
  type AnyCapability,
  type ApprovalRequest,
} from '@tortoise/contracts';
import { collectionGetHandler, collectionListHandler, records } from './collection.js';
import type { HandlerContext, HandlerContribution } from './types.js';

type Ops = typeof approvalOperations;

export interface ApprovalOptions<State, Services> {
  /** The keyed object holding approval requests in the module's state slice. */
  readonly store: (state: State) => Record<string, ApprovalRequest>;
  /** Commands an approval may be requested for: usually every command of the application. */
  readonly commands: readonly AnyCapability[];
  /**
   * Whether the caller may see an approval request. Applied before filters, counts and paging, and by
   * `get`, approve and reject, so a hidden approval request reads as missing. An approval request shows the
   * requested input, so show it to whoever could see that record.
   */
  readonly visible: (
    approval: ApprovalRequest,
    context: HandlerContext<State, Services>,
  ) => boolean;
  readonly newId: (context: HandlerContext<State, Services>) => string;
  readonly now: (context: HandlerContext<State, Services>) => number;
  /** How long an approval request stays pending; 24 hours when omitted. */
  readonly ttlMs?: number;
  /**
   * Check a requested command's input against the application's records at submission, after
   * the schema; throw `INVALID_INPUT` to refuse it, so no person is asked to approve a command
   * the application would refuse. The command checks its input again when it runs.
   */
  readonly check?: (
    operation: string,
    input: unknown,
    context: HandlerContext<State, Services>,
  ) => void;
}

type Context<State, Services> = HandlerContext<State, Services>;

/** The pending, visible, unexpired approval request `id`; otherwise NOT_FOUND or CONFLICT. */
function pendingApproval<State, Services>(
  options: ApprovalOptions<State, Services>,
  ctx: Context<State, Services>,
  id: string,
) {
  const store = records(ctx, approvals, options.store(ctx.state));
  const approval = store.get(id);
  if (!approval || !options.visible(approval, ctx))
    throw new ApplicationError('NOT_FOUND', 'Approval request unavailable');
  if (approval.status !== 'pending')
    throw new ApplicationError('CONFLICT', `Approval request is already ${approval.status}`);
  return { store, approval, expired: approval.expiresAt <= options.now(ctx) };
}

function submitHandler<State, Services>(
  options: ApprovalOptions<State, Services>,
): HandlerContribution<State, Services, Ops['approvalRequest']> {
  const commands = new Map(options.commands.map((command) => [command.id, command]));
  return {
    capability: approvalOperations.approvalRequest,
    handle(input, ctx) {
      const target = commands.get(input.operation);
      // Requesting approval for an approval operation would let approving chain past one continuation.
      if (!target || target.kind !== 'command' || target.id.startsWith('approval.'))
        throw new ApplicationError(
          'INVALID_INPUT',
          `Cannot request approval for ${input.operation}`,
        );
      try {
        target.input.parse(input.input);
      } catch {
        throw new ApplicationError('INVALID_INPUT', 'Requested input does not match the command');
      }
      const { context } = ctx;
      // A requesting agent's run asks only for the commands its definition names.
      if (context.grant?.requests && !context.grant.requests.includes(target.id))
        throw new ApplicationError(
          'FORBIDDEN',
          `Delegation does not permit requesting ${target.id}`,
        );
      // A resource-scoped run requests approval only for the records it was started on.
      const scope = context.grant?.resources;
      if (scope && !(input.resource && scope.includes(input.resource)))
        throw new ApplicationError(
          'FORBIDDEN',
          'Delegation does not permit the requested resource',
        );
      options.check?.(target.id, input.input, ctx);
      const now = options.now(ctx);
      const id = options.newId(ctx);
      const approval: ApprovalRequest = {
        id,
        operation: target.id,
        input: structuredClone(input.input),
        rationale: input.rationale,
        ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
        ...(input.model ? { model: input.model } : {}),
        ...(input.resource ? { resource: input.resource } : {}),
        baseRevisions: { ...input.baseRevisions },
        status: 'pending',
        // Identity comes from the trusted context, never from the requester's input.
        requestedBy: context.principalId,
        ...(context.runId ? { runId: context.runId } : {}),
        createdAt: now,
        expiresAt: now + (options.ttlMs ?? 24 * 60 * 60 * 1000),
      };
      records(ctx, approvals, options.store(ctx.state)).insert(id, approval);
      return approval;
    },
  };
}

/**
 * Handlers of the approval operations. Approving marks the request approved and continues with its
 * command in the same transaction under the approver's context: the command's grant check, policy,
 * `baseRevisions` preconditions and commit recheck all apply to the approver, and a refusal or
 * conflict rolls the approval back, leaving the request pending. A requester whose grant leaves the
 * command out cannot approve its own request for the same reason.
 */
export function approvalHandlers<State, Services>(
  options: ApprovalOptions<State, Services>,
): HandlerContribution<State, Services>[] {
  const read = { store: options.store, visible: options.visible };
  const approve: HandlerContribution<State, Services, Ops['approvalApprove']> = {
    capability: approvalOperations.approvalApprove,
    handle(input, ctx) {
      const { store, approval, expired } = pendingApproval(options, ctx, input.id);
      if (expired) throw new ApplicationError('CONFLICT', 'Approval request expired');
      store.update(approval.id, {
        status: 'approved',
        closedBy: ctx.context.principalId,
        closedAt: options.now(ctx),
      });
      ctx.continueWith(approval.operation, approval.input, approval.baseRevisions);
      return { id: approval.id, status: 'approved' as const, operation: approval.operation };
    },
  };
  const reject: HandlerContribution<State, Services, Ops['approvalReject']> = {
    capability: approvalOperations.approvalReject,
    handle(input, ctx) {
      const { store, approval } = pendingApproval(options, ctx, input.id);
      store.update(approval.id, {
        status: 'rejected',
        closedBy: ctx.context.principalId,
        closedAt: options.now(ctx),
        ...(input.reason ? { reason: input.reason } : {}),
      });
      return { id: approval.id, status: 'rejected' as const };
    },
  };
  const expire: HandlerContribution<State, Services, Ops['approvalExpire']> = {
    capability: approvalOperations.approvalExpire,
    handle(input, ctx) {
      const { store, approval, expired } = pendingApproval(options, ctx, input.id);
      if (!expired) throw new ApplicationError('CONFLICT', 'Approval request has not expired');
      store.update(approval.id, {
        status: 'expired',
        closedBy: ctx.context.principalId,
        closedAt: options.now(ctx),
        reason: 'Expired before anyone approved it',
      });
      return { id: approval.id, status: 'expired' as const };
    },
  };
  return [
    submitHandler(options),
    approve,
    reject,
    expire,
    collectionListHandler(approvals, approvalOperations.approvalList, {
      ...read,
      order: (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1),
    }),
    collectionGetHandler(approvals, approvalOperations.approvalGet, read),
  ] as HandlerContribution<State, Services>[];
}
