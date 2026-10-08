import { ApplicationError } from '@agent-native/contracts';
import type { ExecutionContext } from '@agent-native/runtime';
import type { Sessions } from '@agent-native/adapters/http';
import { UiSessionStore, type UiContextInput } from '@agent-native/adapters/ui-sessions';
import type { HostedApplication } from '../application';

/**
 * Selected resources must name a selectable kind whose read query the caller may run, and the
 * observed revision may not be ahead of the authority.
 */
async function validateResources(
  application: HostedApplication,
  selectableResources: Readonly<Record<string, string>>,
  context: ExecutionContext,
  input: UiContextInput,
) {
  for (const resource of input.selectedResources) {
    const [kind, ...idParts] = resource.split(':');
    const id = idParts.join(':');
    const operation = Object.hasOwn(selectableResources, kind ?? '')
      ? selectableResources[kind!]
      : undefined;
    if (!operation || !id)
      throw new ApplicationError('INVALID_INPUT', 'Unknown selected resource type');
    const snapshot = await application.queryRaw({ operation, input: { id } }, context);
    const revision = (snapshot.data as { revision: number }).revision;
    if ((input.observedRevisions[resource] ?? 0) > revision)
      throw new ApplicationError('CONFLICT', 'Observed revision is ahead of authority');
  }
}

/** UI sessions whose context and intents are checked against the application before routing. */
export function createUiSessions(
  application: HostedApplication,
  sessions: Sessions,
  selectableResources: Readonly<Record<string, string>>,
) {
  const validate = (context: ExecutionContext, input: UiContextInput) =>
    validateResources(application, selectableResources, context, input);
  return new UiSessionStore({
    isActive: (token) => !!sessions.get(token),
    validateContext: validate,
    async validateIntent(context, intent) {
      if ('resource' in intent)
        await validate(context, {
          selectedResources: [intent.resource],
          observedRevisions: { [intent.resource]: 0 },
        });
      else if (
        intent.operations.some(
          (id) => !application.catalog.operations.some((operation) => operation.id === id),
        )
      )
        throw new ApplicationError('INVALID_INPUT', 'Unknown review operation');
    },
  });
}
