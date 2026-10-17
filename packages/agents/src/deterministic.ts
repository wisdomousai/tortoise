import type { Harness, HarnessEvent, HarnessTurn } from './types';

/** Credential-free acceptance fixture. Its prompt is a declarative command script,
 * not a pretend language model: every mutation passes through the host ToolPort. */
export class DeterministicHarness implements Harness {
  readonly id = 'deterministic';
  readonly features = { questions: true, approvals: true, resume: false };
  readonly inference = 'none';
  async availability() {
    return { available: true };
  }
  async *run(turn: HarnessTurn): AsyncIterable<HarnessEvent> {
    const script: {
      commands?: { operation: string; input: unknown }[];
      text?: string;
      question?: string;
      approval?: string;
      failAfterText?: boolean;
    } = JSON.parse(turn.prompt);
    if (!script || !Array.isArray(script.commands))
      throw new Error('Deterministic prompt requires a commands array');
    if (script.question) yield { type: 'progress', message: await turn.question(script.question) };
    if (script.approval && !(await turn.approve(script.approval)))
      throw new Error('Approval declined');
    for (const [index, command] of script.commands.entries()) {
      turn.signal.throwIfAborted();
      if (typeof command.operation !== 'string')
        throw new Error('Command operation must be a string');
      const callId = `command-${index}`;
      yield { type: 'tool-start', operation: command.operation, callId };
      await turn.tools.execute(command.operation, command.input, {
        runId: turn.runId,
        signal: turn.signal,
        idempotencyKey: callId,
      });
      yield { type: 'tool-finish', operation: command.operation, callId };
    }
    if (script.text) yield { type: 'text', text: script.text };
    if (script.failAfterText) throw new Error('Fixture failed after partial text');
  }
}

/** Stateless fixture instance suitable for a composition root. */
export const deterministicHarness: Harness = new DeterministicHarness();
