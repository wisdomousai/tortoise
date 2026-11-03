import { ApplicationError } from '@agent-native/contracts';
import { own, type HandlerContribution } from '@agent-native/runtime';
import { operations } from '../contracts';
import type { AppState } from '../domain';
import { handler, type Services } from './context';

/**
 * The caller's own role. The policy's caller check admits members only, so a role is always
 * there; the refusal guards a policy that changes that. It reads no other member.
 */
export function memberCurrentHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    handler(operations.memberCurrent, (_input, ctx) => {
      const { principalId } = ctx.context;
      const role = own(ctx.state.members, principalId);
      if (!role) throw new ApplicationError('FORBIDDEN', 'Only members have a role');
      return { principalId, role };
    }),
  ];
}
