import { ApplicationError, operationToolSchema } from '@agent-native/contracts';
import type { DelegationGrant, ExecutionContext } from '@agent-native/runtime';
import type { RunSnapshot, ToolExecutionContext, ToolPort } from '@agent-native/agents/types';
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

/**
 * Harness tools over the application. `runOf` reads the supervisor's run, whose context the host
 * captured when the run started; a tool call can never supply its own grants.
 */
export function createAgentTools(
  application: HostedApplication,
  runOf: (id: string) => Promise<RunSnapshot | undefined>,
): ToolPort {
  return {
    definitions: toolDefinitions(application),
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
