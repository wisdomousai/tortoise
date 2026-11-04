import type { AnyCapability, InputOf, OutputOf } from '@tortoise/contracts';
import type { WorklistAssignment } from '@tortoise/assignments/server';
import type { HandlerContext, HandlerContribution } from '@tortoise/runtime';
import { fieldOperations as ops, worklist } from './contracts';
import type { FieldServices, FieldState } from './domain';
import { matches, type SurveyBrief } from './ui-native/brief';

type Context = HandlerContext<FieldState, FieldServices>;

function handler<C extends AnyCapability>(
  capability: C,
  handle: (input: InputOf<C>, context: Context) => OutputOf<C> | Promise<OutputOf<C>>,
): HandlerContribution<FieldState, FieldServices, C> {
  return { capability, handle };
}

const assignmentResource = (id: string) => `${worklist.types.assignment}:${id}`;

/**
 * The device's owner is told of each open survey the first time the hub's feed brings it. The
 * notice waits in the outbox until the app is in the foreground to show it.
 */
export function notifyNewSurvey(assignment: WorklistAssignment, ctx: Context) {
  ctx.enqueue({
    target: 'assignment-notices',
    type: 'assignment.notice',
    resource: assignmentResource(assignment.id),
    payload: {
      principal: ctx.state.ownerId,
      category: 'assignment-new',
      title: 'New assignment',
      body: assignment.title,
    },
  });
}

/** The handlers the OS declarations need next to the worklist's. */
export const createFieldHandlers = () => [
  handler(ops.noticesComplete, (input, ctx) => {
    const effect = ctx.completeEffect(
      input.effectId,
      input.outcome,
      input.fence === undefined ? {} : { fence: input.fence },
    );
    // The outcome is recorded as a change to the survey, which the outbox requires.
    ctx.change(effect.resource);
    return {};
  }),
  // A survey takes captures while the hub lists it and it is not done here.
  handler(ops.tagGet, (input, ctx) => ({
    id: input.id,
    matches: Object.values(ctx.state.worklist.assignments)
      .filter((assignment) => assignment.listed && !assignment.done)
      .flatMap((assignment) =>
        (assignment.brief as SurveyBrief).nodes
          .filter((node) => matches(node, input.id))
          .map((node) => ({
            assignmentId: assignment.id,
            nodeId: node.id,
            designation: node.designation,
            name: node.name,
          })),
      ),
  })),
];
