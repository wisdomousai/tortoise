import { ApplicationError, operationToolSchema, type UiIntent } from '@agent-native/contracts';
import type { DelegationGrant, ExecutionContext } from '@agent-native/runtime';
import type { UiSessionStore } from '@agent-native/adapters/ui-sessions';
import type {
  RunSnapshot,
  ToolDefinition,
  ToolExecutionContext,
  ToolPort,
} from '@agent-native/agents/types';
import type { HostedApplication } from '../application';

/** Every catalog operation as a harness tool taking an `{ input }` envelope, and `expectedRevisions` for a command. */
function toolDefinitions(application: HostedApplication) {
  return application.catalog.operations.map((operation) => ({
    operation: operation.id,
    description: operation.description || operation.id,
    inputSchema: operationToolSchema(operation),
  }));
}

/**
 * The context a tool call executes under. This snapshot was captured from the authenticated
 * session, never from prompt/tool arguments. Delegating a run can narrow instance but cannot
 * restore absent grants.
 */
function runContext(
  application: HostedApplication,
  run: RunSnapshot & { context: { principalId: string; workspaceId: string } },
  signal: AbortSignal,
): ExecutionContext {
  const initiatingGrant = run.context.grant as DelegationGrant | undefined;
  return {
    principalId: run.context.principalId,
    workspaceId: run.context.workspaceId,
    runId: run.id,
    channel: 'harness',
    signal,
    grant: {
      ...initiatingGrant,
      operations:
        initiatingGrant?.operations ?? application.catalog.operations.map((value) => value.id),
      runId: run.id,
      principalId: run.context.principalId,
      workspaceId: run.context.workspaceId,
    },
  };
}

const resourceSchema = {
  type: 'string',
  description: 'A resource ID as `<kind>:<id>`, for example `note:n1`.',
};
const envelope = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  properties: {
    input: { type: 'object', properties, required, additionalProperties: false },
  },
  required: ['input'],
  additionalProperties: false,
});

/**
 * Tools that send a UI intent to the screen the run was started from. They are not catalog
 * operations: they change no records and are not journaled, so every record change stays a
 * command.
 */
const uiTools: readonly (ToolDefinition & { intent: (input: any) => UiIntent })[] = [
  {
    operation: 'ui.open',
    description:
      'Open the screen that shows one resource, on the application screen this request was made from. Refused when you may not read it or no screen shows that kind.',
    inputSchema: envelope({ resource: resourceSchema }, ['resource']),
    intent: (input: { resource: string }) => ({ type: 'openResource', resource: input.resource }),
  },
  {
    operation: 'ui.select',
    description:
      'Select one resource on the screen the person has open, without leaving it. Rejected by the screen when it does not show that kind.',
    inputSchema: envelope({ resource: resourceSchema }, ['resource']),
    intent: (input: { resource: string }) => ({ type: 'selectResource', resource: input.resource }),
  },
  {
    operation: 'ui.request-review',
    description:
      'Ask the person to review your work on their screen: a title, the operations involved and the records to look at, such as the approval requests you created. Nothing is approved by this call.',
    inputSchema: envelope(
      {
        title: { type: 'string', maxLength: 1000 },
        operations: { type: 'array', items: { type: 'string' }, maxItems: 100 },
        resources: { type: 'array', items: resourceSchema, maxItems: 20 },
      },
      ['title', 'operations'],
    ),
    intent: (input: { title: string; operations: string[]; resources?: string[] }) => ({
      type: 'requestReview',
      title: input.title,
      operations: input.operations,
      ...(input.resources ? { resources: input.resources } : {}),
    }),
  },
];

/** The UI session a run captured when it started, if any. */
const capturedSession = (context: Readonly<Record<string, unknown>>) => {
  const ui = context.uiContext as { sessionId?: unknown } | undefined;
  return typeof ui?.sessionId === 'string' ? ui.sessionId : undefined;
};

/**
 * Harness tools over the application. `runOf` reads the supervisor's run, whose context the host
 * captured when the run started; a tool call can never supply its own grants. A run started
 * from a UI session also gets the `ui.*` tools, which send intents only to that session.
 */
export function createAgentTools(
  application: HostedApplication,
  runOf: (id: string) => Promise<RunSnapshot | undefined>,
  uiSessions?: UiSessionStore,
): ToolPort {
  const definitions = toolDefinitions(application);
  const clash = uiTools.find((tool) => definitions.some((d) => d.operation === tool.operation));
  if (clash) throw new Error(`Operation ${clash.operation} is reserved for UI intent tools`);
  const withUi = [
    ...definitions,
    ...uiTools.map(({ operation, description, inputSchema }) => ({
      operation,
      description,
      inputSchema,
    })),
  ];
  return {
    definitions,
    definitionsFor: (context) => (uiSessions && capturedSession(context) ? withUi : definitions),
    async execute(operation: string, input: unknown, toolContext: ToolExecutionContext) {
      const run = await runOf(toolContext.runId);
      if (
        !run ||
        typeof run.context.principalId !== 'string' ||
        typeof run.context.workspaceId !== 'string'
      )
        throw new ApplicationError('FORBIDDEN', 'Run instance unavailable');
      const body = input as { input?: unknown; expectedRevisions?: Record<string, number> };
      if (!body || typeof body !== 'object' || !('input' in body))
        throw new ApplicationError('INVALID_INPUT', 'Tool requires an input envelope');
      const context = runContext(
        application,
        run as RunSnapshot & { context: { principalId: string; workspaceId: string } },
        toolContext.signal,
      );
      const ui = uiTools.find((tool) => tool.operation === operation);
      if (ui) {
        const sessionId = capturedSession(run.context);
        if (!uiSessions || !sessionId)
          throw new ApplicationError('NOT_FOUND', 'This run was not started from a UI session');
        if (!body.input || typeof body.input !== 'object')
          throw new ApplicationError('INVALID_INPUT', 'UI intent input must be an object');
        const id = await uiSessions.sendFromRun(context, sessionId, ui.intent(body.input));
        return { id, status: 'pending' };
      }
      const definition = application.catalog.operations.find((value) => value.id === operation);
      if (!definition) throw new ApplicationError('NOT_FOUND', 'Unknown operation');
      const request = {
        operation,
        input: body.input,
        expectedRevisions: body.expectedRevisions,
        idempotencyKey: `${run.id}:${toolContext.idempotencyKey ?? crypto.randomUUID()}`,
      };
      return definition.kind === 'query'
        ? application.queryRaw(request, context)
        : application.invokeRaw(request, context);
    },
  };
}
