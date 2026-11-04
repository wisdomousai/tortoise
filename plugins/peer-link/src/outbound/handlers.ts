import { ApplicationError, type InputOf } from '@tortoise/contracts';
import type { HandlerContext, HandlerContribution } from '@tortoise/runtime';
import { peerLinkOperations as ops } from '../contracts';
import { serviceOf, type PeerLinkServices } from '../service';
import type { PeerLinkState } from '../state';

type Context = HandlerContext<PeerLinkState, PeerLinkServices>;

function record(input: InputOf<typeof ops.connectionRecord>, ctx: Context) {
  const { targets, now } = serviceOf(ctx);
  const target = targets.get(input.target);
  if (!target)
    throw new ApplicationError('INVALID_INPUT', `${input.target} is not a peer target here`);
  // The code may belong to another application than the target expects; its operations would
  // then be called with input meant for a different API.
  if (input.contract.id !== target.application)
    throw new ApplicationError(
      'CONFLICT',
      `The code was issued by ${input.contract.id}, not ${target.application}`,
    );
  const connection = {
    ...input,
    contract: { ...input.contract },
    connectedBy: ctx.context.principalId,
    connectedAt: now(),
  };
  ctx.state.connections[input.target] = connection;
  ctx.change(`peer-connection:${input.target}`, 'peer.connection.recorded');
  return { connection };
}

export const connectionHandlers: HandlerContribution<PeerLinkState, PeerLinkServices>[] = [
  { capability: ops.connectionRecord, handle: async (input, ctx) => record(input as never, ctx) },
  {
    capability: ops.connectionList,
    handle: async (_input, ctx) => ({
      targets: [...serviceOf(ctx).targets].map(([target, { application }]) => ({
        target,
        application,
        connection: Object.hasOwn(ctx.state.connections, target)
          ? ctx.state.connections[target]!
          : null,
      })),
    }),
  },
  {
    capability: ops.connectionRemove,
    handle: async (input, ctx) => {
      const { target } = input as { target: string };
      const removed = Object.hasOwn(ctx.state.connections, target);
      if (removed) {
        delete ctx.state.connections[target];
        ctx.change(`peer-connection:${target}`, 'peer.connection.removed');
      }
      return { removed };
    },
  },
];
