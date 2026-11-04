import { definePolicy, own, type OperationRule } from '@tortoise/runtime';
import { fleetInstanceOperationIds } from '@tortoise/fleet-agent/contracts';
import { operations } from './contracts';
import { desiredRelease, instanceIdOf, type AppState, type Role } from './domain';

const roleOf = (state: AppState, principalId: string) => own(state.members, principalId);
const operator: OperationRule<AppState, Role> = {
  allow: ({ state, context }) => roleOf(state, context.principalId) === 'operator',
};

/**
 * Fleet policy. People pass the caller gate only as workspace members; operators change things,
 * viewers read. An enrolled instance is the device-link principal `device:<id>`: it holds no role and
 * calls only the fleet protocol, whose handlers return data about the calling instance alone. Of the
 * fleet's records it may read only the release its channel assigns, which is what lets it fetch
 * that release's files and no other blob. An operation this policy does not list is denied.
 */
export const appPolicy = definePolicy<AppState, Role>({
  integrations: [
    {
      is: (_state, principalId) => instanceIdOf(principalId) !== undefined,
      operations: fleetInstanceOperationIds,
      events: (event, state, principalId) => {
        const release = desiredRelease(state, instanceIdOf(principalId)!);
        return release !== undefined && event.resource === `release:${release.id}`;
      },
    },
  ],
  caller: { allow: (state, context) => roleOf(state, context.principalId) !== undefined },
  operations: {
    ...Object.fromEntries(fleetInstanceOperationIds.map((id) => [id, 'integration' as const])),
    [operations.instanceList.id]: 'open',
    [operations.instanceGet.id]: 'open',
    [operations.instanceUpdate.id]: operator,
    // Removing an instance is a person's act, like remote access.
    [operations.instanceRemove.id]: { ...operator, person: true },
    [operations.fleetHealth.id]: 'open',
    [operations.releaseList.id]: 'open',
    [operations.releaseGet.id]: 'open',
    [operations.releasePublish.id]: operator,
    [operations.channelList.id]: 'open',
    [operations.channelGet.id]: 'open',
    [operations.channelAssign.id]: operator,
    [operations.auditEventList.id]: 'open',
    [operations.auditEventGet.id]: 'open',
    [operations.relayList.id]: 'open',
    [operations.relayGet.id]: 'open',
    // Remote access is a person's act; an agent run cannot reach an instance through the fleet.
    [operations.relayRequest.id]: { ...operator, person: true },
  },
  events: {
    instance: () => true,
    release: () => true,
    channel: () => true,
    'audit-event': () => true,
    relay: () => true,
  },
});
