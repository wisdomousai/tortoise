import { isStepCount, jsonSchema, streamText, tool, type LanguageModel, type ToolSet } from 'ai';
import type { Harness, HarnessEvent, HarnessTurn } from './types';
import { toolName } from './types';

/** The host constructs the model with explicitly chosen credentials. No string model
 * aliases or default gateway are accepted because those may discover ambient keys. */
export class AiSdkHarness implements Harness {
  readonly id = 'ai-sdk';
  readonly features = { questions: false, approvals: false, resume: false };
  constructor(
    private readonly options: { model: LanguageModel; maxSteps?: number; maxOutputTokens?: number },
  ) {
    if (typeof options.model === 'string')
      throw new Error('Supply an explicitly configured model instance');
  }
  async availability() {
    return { available: true };
  }
  async *run(turn: HarnessTurn): AsyncIterable<HarnessEvent> {
    const definitions = turn.tools.definitions;
    if (!definitions?.length) throw new Error('AI SDK harness requires catalog tool definitions');
    const tools: ToolSet = Object.fromEntries(
      definitions.map((definition) => [
        toolName(definition.operation),
        tool({
          description: definition.description,
          inputSchema: jsonSchema<Record<string, unknown>>(definition.inputSchema),
          execute: async (input, { toolCallId }) => {
            turn.signal.throwIfAborted();
            return turn.tools.execute(definition.operation, input, {
              runId: turn.runId,
              signal: turn.signal,
              idempotencyKey: toolCallId,
            });
          },
        }),
      ]),
    );
    const byName = new Map(
      definitions.map((definition) => [toolName(definition.operation), definition.operation]),
    );
    const result = streamText({
      model: this.options.model,
      prompt: turn.prompt,
      tools,
      stopWhen: isStepCount(this.options.maxSteps ?? 12),
      maxOutputTokens: this.options.maxOutputTokens ?? 4_096,
      abortSignal: turn.signal,
    });
    for await (const part of result.stream) {
      turn.signal.throwIfAborted();
      if (part.type === 'text-delta') yield { type: 'text', text: part.text };
      else if (part.type === 'tool-call')
        yield {
          type: 'tool-start',
          operation: byName.get(part.toolName) ?? part.toolName,
          callId: part.toolCallId,
        };
      else if (part.type === 'tool-result')
        yield {
          type: 'tool-finish',
          operation: byName.get(part.toolName) ?? part.toolName,
          callId: part.toolCallId,
        };
      else if (part.type === 'error')
        throw part.error instanceof Error ? part.error : new Error(String(part.error));
      else if (part.type === 'tool-error')
        throw new Error(`Application tool failed: ${byName.get(part.toolName) ?? part.toolName}`);
      else if (part.type === 'abort') throw new Error('Provider stream aborted');
    }
    const finish = await result.finishReason;
    if (finish !== 'stop') throw new Error(`Provider did not finish normally: ${finish}`);
  }
}
