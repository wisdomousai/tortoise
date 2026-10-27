import type { HandlerContribution } from '@agent-native/runtime';
import type { AppState } from './domain';
import type { Services } from './handlers/context';
import { auditHandlers } from './handlers/audit';
import { relayHandlers } from './handlers/relay';
import { releaseHandlers } from './handlers/releases';
import { siteHandlers } from './handlers/sites';

export type { Services } from './handlers/context';
export { appPolicy } from './policy';

/** Every handler of the application, the fleet protocol's included. */
export function createHandlers(): HandlerContribution<AppState, Services>[] {
  return [...siteHandlers(), ...releaseHandlers(), ...auditHandlers(), ...relayHandlers()];
}
