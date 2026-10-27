import type { OsActionOutcome, OutputOf } from '@agent-native/contracts';
import type { NativeSession } from '@agent-native/frame-native/session';
import { fieldOperations as ops } from '../contracts';

type Capture = OutputOf<typeof ops.captureList>['items'][number];
type FieldNode = OutputOf<typeof ops.nodeList>['items'][number];

/**
 * The screen an asset tag from another app opens. Open assignments are searched as a scan
 * searches one: a tag that finds one node opens its capture with the tag recorded, nodes within
 * one assignment open its search, and anything else opens the assignment list.
 */
export async function tagScreen(tag: string, session: Pick<NativeSession, 'client'>) {
  const { matches } = (await session.client.query(ops.tagGet, { id: tag })).data;
  const assignments = new Set(matches.map((match) => match.assignmentId));
  const [first] = matches;
  if (matches.length === 1)
    return {
      to: '/capture',
      params: { assignmentId: first!.assignmentId, nodeId: first!.nodeId, codes: [tag] },
    };
  if (assignments.size === 1)
    return { to: '/assignment', params: { assignmentId: first!.assignmentId, q: tag } };
  return { to: '/assignments' };
}

/** The extras of a work request for `node`, which the maintenance app receives. */
export const workRequest = (node: Pick<FieldNode, 'designation' | 'name'>, note: string) => ({
  designation: node.designation,
  name: node.name,
  note: note.trim(),
});

/** A capture as shareable text. The photos stay on the device; the share sheet carries text. */
export function captureSummary(capture: Capture) {
  const subject = capture.codes.length ? ` of ${capture.codes.join(', ')}` : '';
  return [
    `${capture.kind} capture${subject}${capture.nodeId ? '' : ', unplaced'}`,
    capture.condition ? `Condition: ${capture.condition}` : undefined,
    capture.note || undefined,
    `${capture.photos.length} ${capture.photos.length === 1 ? 'photo' : 'photos'}, taken ${new Date(capture.takenAt).toLocaleString()}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Why the device refused an OS action, for the screen; undefined otherwise. */
export const refusal = (what: string, outcome: OsActionOutcome) =>
  outcome.status === 'refused' ? new Error(`${what}: ${outcome.reason}`) : undefined;
