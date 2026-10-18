import { isStepCount, jsonSchema, streamText, tool, type LanguageModel, type ToolSet } from 'ai';
import { ApplicationError, errorEnvelope } from '@agent-native/contracts';
import type { Harness, HarnessEvent, HarnessTurn } from './types';
import { modelPrompt, toolName } from './types';

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
            try {
              return await turn.tools.execute(definition.operation, input, {
                runId: turn.runId,
                signal: turn.signal,
                idempotencyKey: toolCallId,
              });
            } catch (error) {
              // A refusal is the application's answer: the model reads it and may correct the
              // call, as an MCP client reads `isError`. A spent budget or a cancellation aborts
              // the run's signal, and any other failure ends the run.
              if (turn.signal.aborted || !(error instanceof ApplicationError)) throw error;
              return { error: errorEnvelope(error) };
            }
          },
        }),
      ]),
    );
    const byName = new Map(
      definitions.map((definition) => [toolName(definition.operation), definition.operation]),
    );
    const result = streamText({
      model: this.options.model,
      prompt: modelPrompt(turn),
      tools,
      // A run budget can only lower the configured limit.
      stopWhen: isStepCount(Math.min(this.options.maxSteps ?? 12, turn.budget?.turns ?? Infinity)),
      maxOutputTokens: this.options.maxOutputTokens ?? 4_096,
      abortSignal: turn.signal,
    });
    // Calls the model got wrong: an unknown tool, or input it could not parse or that its schema
    // refuses. They never reach the application, and their errors go back to the model.
    const invalid = new Set<string>();
    for await (const part of result.stream) {
      turn.signal.throwIfAborted();
      if (part.type === 'text-delta') yield { type: 'text', text: part.text };
      else if (part.type === 'tool-call' && part.invalid) invalid.add(part.toolCallId);
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
      else if (part.type === 'tool-error') {
        // The next step may correct a call the model got wrong; a tool that failed ends the run.
        if (invalid.has(part.toolCallId)) continue;
        throw new Error(`Application tool failed: ${byName.get(part.toolName) ?? part.toolName}`);
      } else if (part.type === 'abort') throw new Error('Provider stream aborted');
    }
    const finish = await result.finishReason;
    if (finish === 'tool-calls')
      throw new Error('The model was still calling tools when it reached its turn limit');
    if (finish !== 'stop') throw new Error(`Provider did not finish normally: ${finish}`);
  }
}
