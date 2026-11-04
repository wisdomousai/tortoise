import { isStepCount, jsonSchema, streamText, tool, type LanguageModel, type ToolSet } from 'ai';
import { ApplicationError, errorEnvelope } from '@tortoise/contracts';
import type { Harness, HarnessEvent, HarnessTurn } from './types';
import { modelPrompt, toolDescription, toolName } from './types';

/** The tool a model asks the person with; outside the `app_` names catalog tools take. */
export const ASK_TOOL = 'ask_person';

/**
 * A run started from a screen has a person waiting at it, so its model may ask them one question
 * at a time and wait for the answer. A run without a UI session gets no such tool, since nobody
 * would answer; a trigger's run carries its resource as UI context but no session ID.
 */
const attended = (turn: HarnessTurn) =>
  typeof (turn.context.uiContext as { sessionId?: unknown } | undefined)?.sessionId === 'string';

function askTool(turn: HarnessTurn) {
  return tool({
    description:
      'Ask the person who made this request one short question and wait for their answer, when the request is ambiguous or names something you cannot find. Offer choices when there are a few likely answers. Changes nothing.',
    inputSchema: jsonSchema<{ question: string; choices?: string[] }>({
      type: 'object',
      properties: {
        question: { type: 'string', minLength: 1, maxLength: 1000 },
        choices: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 200 },
          maxItems: 6,
        },
      },
      required: ['question'],
      additionalProperties: false,
    }),
    execute: async ({ question, choices }) => ({
      answer: await turn.question(question, choices?.length ? choices : undefined),
    }),
  });
}

/** The host constructs the model with explicitly chosen credentials. No string model
 * aliases or default gateway are accepted because those may discover ambient keys. */
export class AiSdkHarness implements Harness {
  readonly id = 'ai-sdk';
  /** Questions only for a run started from a screen; see `ASK_TOOL`. */
  readonly features = { questions: true, approvals: false, resume: false };
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
          description: toolDescription(definition),
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
              // A refusal is the application's response: the model reads it and may correct the
              // call, as an MCP client reads `isError`. A spent budget or a cancellation aborts
              // the run's signal, and any other failure ends the run.
              if (turn.signal.aborted || !(error instanceof ApplicationError)) throw error;
              return { error: errorEnvelope(error) };
            }
          },
        }),
      ]),
    );
    if (attended(turn)) tools[ASK_TOOL] = askTool(turn);
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
      // A question shows as the run's question event, not as a tool call.
      else if (
        (part.type === 'tool-call' || part.type === 'tool-result') &&
        part.toolName === ASK_TOOL
      )
        continue;
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
