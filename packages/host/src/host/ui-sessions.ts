import { ApplicationError } from '@tortoise/contracts';
import type { ExecutionContext } from '@tortoise/runtime';
import type { Sessions } from '@tortoise/adapters/http';
import { UiDeliveryStore } from '@tortoise/adapters/ui-deliveries';
import { UiSessionStore, type UiContextInput } from '@tortoise/adapters/ui-sessions';
import type { HostedApplication } from '../application';

/**
 * Selected resources must name a selectable kind whose read query the caller may run, and the
 * observed revision may not be ahead of the instance.
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
    const revision = (snapshot.data as { revision?: unknown }).revision;
    const observed = input.observedRevisions[resource] ?? 0;
    // A read without a revision cannot confirm an observed one, so only 0 passes for it.
    if (typeof revision !== 'number') {
      if (observed > 0)
        throw new ApplicationError('INVALID_INPUT', `The read of ${kind} returns no revision`);
      continue;
    }
    if (observed > revision)
      throw new ApplicationError('CONFLICT', 'Observed revision is ahead of instance');
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
    // Every resource an intent names must be one the sender may read now, as for a selection.
    // A prepared form must belong to a command the application offers in its UI; its values
    // are untrusted, and the command validates them again when the person submits.
    async validateIntent(context, intent) {
      if (intent.type === 'prepare') {
        const operation = application.catalog.operations.find((o) => o.id === intent.operation);
        if (operation?.kind !== 'command' || !operation.ui?.binding)
          throw new ApplicationError('INVALID_INPUT', 'Unknown prepared command');
        return;
      }
      const resources = 'resource' in intent ? [intent.resource] : (intent.resources ?? []);
      await validate(context, {
        selectedResources: [...resources],
        observedRevisions: Object.fromEntries(resources.map((resource) => [resource, 0])),
      });
      if (
        'operations' in intent &&
        intent.operations.some(
          (id) => !application.catalog.operations.some((operation) => operation.id === id),
        )
      )
        throw new ApplicationError('INVALID_INPUT', 'Unknown review operation');
    },
  });
}

/**
 * Deliveries from OS requests. An opened resource must be readable now, as for an agent's
 * intent; a prepared form must belong to a command the application offers in its UI. Prefilled
 * values are untrusted and are validated again by the command when a person submits the form.
 */
export function createUiDeliveries(
  application: HostedApplication,
  sessions: Sessions,
  selectableResources: Readonly<Record<string, string>>,
) {
  return new UiDeliveryStore({
    isActive: (token) => !!sessions.get(token),
    async validate(context, delivery) {
      if (delivery.type === 'openResource')
        await validateResources(application, selectableResources, context, {
          selectedResources: [delivery.resource],
          observedRevisions: { [delivery.resource]: 0 },
        });
      if (delivery.type === 'prepare') {
        const operation = application.catalog.operations.find((o) => o.id === delivery.operation);
        if (operation?.kind !== 'command' || !operation.ui?.binding)
          throw new ApplicationError('INVALID_INPUT', 'Unknown prepared command');
      }
    },
  });
}
