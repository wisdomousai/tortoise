import type { HandlerContribution } from '@tortoise/runtime';
import type { AppState } from './domain';
import type { Services } from './handlers/context';
import { auditHandlers } from './handlers/audit';
import { relayHandlers } from './handlers/relay';
import { releaseHandlers } from './handlers/releases';
import { instanceHandlers } from './handlers/instances';

export type { Services } from './handlers/context';
export { appPolicy } from './policy';

/** Every handler of the application, the fleet protocol's included. */
export function createHandlers(): HandlerContribution<AppState, Services>[] {
  return [...instanceHandlers(), ...releaseHandlers(), ...auditHandlers(), ...relayHandlers()];
}
