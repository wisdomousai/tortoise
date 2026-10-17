import { ApplicationError, type Membership, type SetMemberInput } from '@agent-native/contracts';
import { own, put } from './collection.js';
import type { OperationRule } from './policy.js';
import type { HandlerContribution } from './types.js';

type RoleOf<M extends Membership> = M['roles'][number];

export interface MembershipStore<State, Role extends string> {
  /** The role map of one container in `state`, or undefined when the container does not exist. */
  readonly members: (state: State, container: string) => Record<string, Role> | undefined;
  /** Principals that never hold a role, such as integration principals; they act through lanes. */
  readonly reserved?: (state: State, principalId: string) => boolean;
}

/** The caller's role in a container, or undefined. Inherited keys are never roles. */
export function roleIn<State, Role extends string>(
  store: MembershipStore<State, Role>,
  state: State,
  principalId: string,
  container: string,
): Role | undefined {
  const members = store.members(state, container);
  return members ? own(members, principalId) : undefined;
}

/**
 * The handler of a membership's `set-member`. It refuses a change to the caller's own role, so
 * a manager cannot lock everyone out or raise themselves, and a role for a reserved principal.
 * The change is the container's resource with the event `authorization.changed`, so open views
 * drop protected data in the same commit.
 */
export function membershipHandler<State, Services, M extends Membership>(
  membership: M,
  store: MembershipStore<State, RoleOf<M>>,
): HandlerContribution<State, Services, M['setMember']> {
  const { field, type, label } = membership.container;
  return {
    capability: membership.setMember,
    handle(input, ctx) {
      const args = input as unknown as SetMemberInput<string, RoleOf<M>> & Record<string, unknown>;
      const container = String(args[field]);
      const members = store.members(ctx.state, container);
      if (!members) throw new ApplicationError('NOT_FOUND', `${label} unavailable`);
      if (args.principalId === ctx.context.principalId)
        throw new ApplicationError('FORBIDDEN', `You cannot change your own ${type} role`);
      if (store.reserved?.(ctx.state, args.principalId))
        throw new ApplicationError('FORBIDDEN', `Integration principals have no ${type} role`);
      if (args.role === null) delete members[args.principalId];
      else put(members, args.principalId, args.role as RoleOf<M>);
      ctx.change(`${type}:${container}`, 'authorization.changed');
      return { [field]: container, members: { ...members } } as never;
    },
  };
}

/** The policy rule of `set-member`: the manager role in the named container. */
export function membershipRule<State, M extends Membership>(
  membership: M,
): OperationRule<State, RoleOf<M>> {
  const { field } = membership.container;
  return {
    container: (input) => (typeof input[field] === 'string' ? input[field] : undefined),
    roles: [membership.manager],
  };
}
