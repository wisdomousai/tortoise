import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { HarnessTurn, ToolDefinition } from '../types';
import { toolName } from '../types';

/** The SDK name of an application tool on the in-process `application` MCP server. */
export const applicationToolName = (definition: ToolDefinition) =>
  `mcp__application__${toolName(definition.operation)}`;

/**
 * The application's tools as an in-process MCP server. Every call goes through the turn's tool
 * port, keyed by the SDK request ID so a retried call is not executed twice.
 */
export function applicationMcpServer(turn: HarnessTurn, definitions: readonly ToolDefinition[]) {
  // JSON Schema validation remains authoritative in the application runtime. Zod's
  // JSON Schema converter preserves catalog validation for the provider tool schema.
  return createSdkMcpServer({
    name: 'application',
    version: '1.0.0',
    tools: definitions.map((definition) => {
      const schema = z.fromJSONSchema(definition.inputSchema) as z.ZodObject;
      if (!('shape' in schema))
        throw new Error('Application tool input schema must describe an object');
      return tool(
        toolName(definition.operation),
        definition.description,
        schema.shape,
        async (input, extra) => {
          turn.signal.throwIfAborted();
          const requestId = (extra as Record<string, unknown> | undefined)?.requestId;
          const callId = typeof requestId === 'string' ? requestId : crypto.randomUUID();
          const result = await turn.tools.execute(definition.operation, input, {
            runId: turn.runId,
            signal: turn.signal,
            idempotencyKey: callId,
          });
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        },
      );
    }),
  });
}
