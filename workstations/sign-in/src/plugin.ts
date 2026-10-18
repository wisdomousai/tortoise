import { LOCAL_OWNER } from '@agent-native/kernel/instance';
import { defineHostPlugin } from '@agent-native/kernel/plugin';
import type { ExecutionContext } from '@agent-native/runtime';
import { stationSignInOperations as ops } from './contracts';
import {
  stationSignInHandlers,
  stationSignInPolicy,
  type StationSignInService,
  type StationSignInServices,
} from './handlers';
import { stationSignInPluginManifest } from './plugin-manifest';
import { stationRoute, type StationCaller } from './routes';
import { createStationSignInState, digestOf, type StationSignInState } from './state';

/** The shape `newOperatorToken` produces; anything else is not an operator token. */
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

function minutesOf(setting: string | undefined) {
  if (setting === undefined) return 15;
  const minutes = Number(setting);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 720)
    throw new Error('station-sign-in-minutes must be a whole number from 1 to 720');
  return minutes;
}

/**
 * The person an operator token stands for, looked up through the runtime on every request, so a
 * sign-out, a revoked badge or an expiry applies at the next one. The context carries no grant:
 * the operator acts with their own grants under the application's policy.
 */
async function authenticateOperator(
  token: string,
  caller: StationCaller | undefined,
): Promise<ExecutionContext | undefined> {
  if (!caller || !tokenPattern.test(token)) return undefined;
  const result = await caller.application.queryRaw(
    { operation: ops.sessionResolve.id, input: { tokenDigest: digestOf(token) } },
    caller.context,
  );
  const session = (result.data as { session: { principalId: string } | null }).session;
  return session
    ? { workspaceId: caller.workspaceId, principalId: session.principalId }
    : undefined;
}

/**
 * Shared-station sign-in on a serving host. Its slice holds badges and operator sessions by
 * digest only. Once the host listens it serves the sign-in, sign-out and enrollment routes and
 * resolves operator tokens on every request; before that the routes answer as unavailable.
 */
export function createStationSignInPlugin(options: { readonly now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  return defineHostPlugin<StationSignInState, StationSignInServices>({
    manifest: stationSignInPluginManifest,
    state: { create: createStationSignInState },
    handlers: stationSignInHandlers,
    authorization: { resourceTypes: ['badge', 'operator-session'], port: stationSignInPolicy },
    async open({ settings }) {
      const service: StationSignInService = {
        now,
        sessionMinutes: minutesOf(settings['station-sign-in-minutes']),
      };
      const seats = new Set([
        LOCAL_OWNER,
        ...(settings['station-sign-in-seats'] ?? '')
          .split(',')
          .map((seat) => seat.trim())
          .filter(Boolean),
      ]);
      let caller: StationCaller | undefined;
      return {
        service,
        async start(context) {
          caller = {
            application: context.application,
            workspaceId: context.workspaceId,
            context: context.delegate({
              operations: [
                ops.badgeVerifier.id,
                ops.sessionStart.id,
                ops.sessionEnd.id,
                ops.sessionResolve.id,
              ],
            }),
          };
          return [{ stop: async () => void (caller = undefined) }];
        },
        route: (request, context) => stationRoute(request, context, caller, { seats }),
        authenticate: (token) => authenticateOperator(token, caller),
        describe: () => ({ seats: [...seats], sessionMinutes: service.sessionMinutes }),
      };
    },
  });
}

export const stationSignInPlugin = createStationSignInPlugin();
export default stationSignInPlugin;
