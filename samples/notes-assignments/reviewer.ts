import type { Harness, HarnessEvent, HarnessTurn } from '@agent-native/agents/types';
import { assignmentOperations, reviewer } from './contracts';

type BriefNote = { id: string; title: string; text: string };

/** The verdict the rule gives: revise a note with no title or under 40 characters of text. */
export function verdictOf(note: BriefNote) {
  if (!note.title.trim()) return { verdict: 'revise' as const, comment: 'Give the note a title.' };
  if (note.text.trim().length < 40)
    return { verdict: 'revise' as const, comment: 'Say more: the text is very short.' };
  return { verdict: 'keep' as const, comment: 'Reads complete.' };
}

/**
 * The reviewer agent's stand-in for a model, so the sample runs with no model and no credentials.
 * It calls the same tools a model would, through the run's grant: it reads the assignment the run
 * was started on, reports a verdict per note by a fixed rule and marks the assignment done. An
 * application with a model lists that model's harness instead.
 */
export const ruleReviewer: Harness = {
  id: 'rule-reviewer',
  features: { questions: false, approvals: false, resume: false },
  inference: 'none',
  agents: [reviewer.id],
  availability: async () => ({ available: true }),
  async *run(turn: HarnessTurn): AsyncIterable<HarnessEvent> {
    const selected = (turn.context.uiContext as { selectedResources?: string[] } | undefined)
      ?.selectedResources?.[0];
    if (!selected?.startsWith('assignment:'))
      throw new Error('The run was not started on an assignment');
    const id = selected.slice('assignment:'.length);
    let calls = 0;
    const call = async function* (operation: string, input: object) {
      const callId = `rule-${++calls}`;
      yield { type: 'tool-start', operation, callId } as const;
      const result = await turn.tools.execute(
        operation,
        { input },
        { runId: turn.runId, signal: turn.signal, idempotencyKey: callId },
      );
      yield { type: 'tool-finish', operation, callId } as const;
      return result;
    };
    const read = (yield* call(assignmentOperations.get.id, { id })) as {
      data: { brief: { notes: BriefNote[] } };
    };
    for (const note of read.data.brief.notes)
      yield* call(assignmentOperations.reviewReport.id, {
        id: `${id}-${note.id}`,
        assignmentId: id,
        subject: note.id,
        body: verdictOf(note),
      });
    yield* call(assignmentOperations.complete.id, { id });
    yield { type: 'text', text: `Reviewed ${read.data.brief.notes.length} notes.` };
  },
};
