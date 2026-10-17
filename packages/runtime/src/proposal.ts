import {
  ApplicationError,
  proposalOperations,
  proposals,
  type AnyCapability,
  type Proposal,
} from '@agent-native/contracts';
import { collectionGetHandler, collectionListHandler, records } from './collection.js';
import type { HandlerContext, HandlerContribution } from './types.js';

type Ops = typeof proposalOperations;

export interface ProposalOptions<State, Services> {
  /** The keyed object holding proposals in the module's state slice. */
  readonly store: (state: State) => Record<string, Proposal>;
  /** Commands that may be proposed: usually every command of the application. */
  readonly commands: readonly AnyCapability[];
  /**
   * Whether the caller may see a proposal. Applied before filters, counts and paging, and by
   * `get`, accept and reject, so a hidden proposal reads as missing. A proposal shows the
   * proposed input, so show it to whoever could see that record.
   */
  readonly visible: (proposal: Proposal, context: HandlerContext<State, Services>) => boolean;
  readonly newId: (context: HandlerContext<State, Services>) => string;
  readonly now: (context: HandlerContext<State, Services>) => number;
  /** How long a proposal stays open; 24 hours when omitted. */
  readonly ttlMs?: number;
}

type Context<State, Services> = HandlerContext<State, Services>;

/** The open, visible, unexpired proposal `id`; otherwise NOT_FOUND or CONFLICT. */
function openProposal<State, Services>(
  options: ProposalOptions<State, Services>,
  ctx: Context<State, Services>,
  id: string,
) {
  const store = records(ctx, proposals, options.store(ctx.state));
  const proposal = store.get(id);
  if (!proposal || !options.visible(proposal, ctx))
    throw new ApplicationError('NOT_FOUND', 'Proposal unavailable');
  if (proposal.status !== 'open')
    throw new ApplicationError('CONFLICT', `Proposal is already ${proposal.status}`);
  return { store, proposal, expired: proposal.expiresAt <= options.now(ctx) };
}

function submitHandler<State, Services>(
  options: ProposalOptions<State, Services>,
): HandlerContribution<State, Services, Ops['proposalSubmit']> {
  const commands = new Map(options.commands.map((command) => [command.id, command]));
  return {
    capability: proposalOperations.proposalSubmit,
    handle(input, ctx) {
      const target = commands.get(input.operation);
      // Proposing a proposal operation would let acceptance chain past one continuation.
      if (!target || target.kind !== 'command' || target.id.startsWith('proposal.'))
        throw new ApplicationError('INVALID_INPUT', `Cannot propose ${input.operation}`);
      try {
        target.input.parse(input.input);
      } catch {
        throw new ApplicationError('INVALID_INPUT', 'Proposed input does not match the command');
      }
      const { context } = ctx;
      // A resource-scoped run proposes only for the records it was started on.
      const scope = context.grant?.resources;
      if (scope && !(input.resource && scope.includes(input.resource)))
        throw new ApplicationError('FORBIDDEN', 'Delegation does not permit the proposed resource');
      const now = options.now(ctx);
      const id = options.newId(ctx);
      const proposal: Proposal = {
        id,
        operation: target.id,
        input: structuredClone(input.input),
        rationale: input.rationale,
        ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
        ...(input.model ? { model: input.model } : {}),
        ...(input.resource ? { resource: input.resource } : {}),
        baseRevisions: { ...input.baseRevisions },
        status: 'open',
        // Identity comes from the trusted context, never from the proposer's input.
        proposedBy: context.principalId,
        ...(context.runId ? { runId: context.runId } : {}),
        createdAt: now,
        expiresAt: now + (options.ttlMs ?? 24 * 60 * 60 * 1000),
      };
      records(ctx, proposals, options.store(ctx.state)).insert(id, proposal);
      return proposal;
    },
  };
}

/**
 * Handlers of the proposal operations. Accepting marks the proposal accepted and continues with
 * its command in the same transaction under the accepter's context: the command's grant check,
 * policy, `baseRevisions` preconditions and commit recheck all apply to the accepter, and a
 * refusal or conflict rolls the acceptance back, leaving the proposal open. A proposer whose
 * grant leaves the command out cannot accept its own proposal for the same reason.
 */
export function proposalHandlers<State, Services>(
  options: ProposalOptions<State, Services>,
): HandlerContribution<State, Services>[] {
  const read = { store: options.store, visible: options.visible };
  const accept: HandlerContribution<State, Services, Ops['proposalAccept']> = {
    capability: proposalOperations.proposalAccept,
    handle(input, ctx) {
      const { store, proposal, expired } = openProposal(options, ctx, input.id);
      if (expired) throw new ApplicationError('CONFLICT', 'Proposal expired');
      store.update(proposal.id, {
        status: 'accepted',
        closedBy: ctx.context.principalId,
        closedAt: options.now(ctx),
      });
      ctx.continueWith(proposal.operation, proposal.input, proposal.baseRevisions);
      return { id: proposal.id, status: 'accepted' as const, operation: proposal.operation };
    },
  };
  const reject: HandlerContribution<State, Services, Ops['proposalReject']> = {
    capability: proposalOperations.proposalReject,
    handle(input, ctx) {
      const { store, proposal } = openProposal(options, ctx, input.id);
      store.update(proposal.id, {
        status: 'rejected',
        closedBy: ctx.context.principalId,
        closedAt: options.now(ctx),
        ...(input.reason ? { reason: input.reason } : {}),
      });
      return { id: proposal.id, status: 'rejected' as const };
    },
  };
  const expire: HandlerContribution<State, Services, Ops['proposalExpire']> = {
    capability: proposalOperations.proposalExpire,
    handle(input, ctx) {
      const { store, proposal, expired } = openProposal(options, ctx, input.id);
      if (!expired) throw new ApplicationError('CONFLICT', 'Proposal has not expired');
      store.update(proposal.id, {
        status: 'expired',
        closedBy: ctx.context.principalId,
        closedAt: options.now(ctx),
        reason: 'Expired before anyone accepted it',
      });
      return { id: proposal.id, status: 'expired' as const };
    },
  };
  return [
    submitHandler(options),
    accept,
    reject,
    expire,
    collectionListHandler(proposals, proposalOperations.proposalList, {
      ...read,
      order: (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1),
    }),
    collectionGetHandler(proposals, proposalOperations.proposalGet, read),
  ] as HandlerContribution<State, Services>[];
}
