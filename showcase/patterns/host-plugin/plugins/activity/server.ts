import type { InputOf, OutputOf } from '@tortoise/contracts';
import type { AuthorizationPort, HandlerContribution } from '@tortoise/runtime';
import { activityModule, activityOperations } from './contracts';

/** Counts and who may read and record them, under `state.activity`. */
export interface ActivityState {
  readers: string[];
  cursor: number;
  counts: Record<string, number>;
}
export const createActivityState = (localUserId: string): ActivityState => ({
  readers: [localUserId],
  cursor: 0,
  counts: {},
});

/** The plugin's service: what the launcher configured. */
export interface ActivityService {
  readonly modules: readonly string[];
}
export interface ActivityServices {
  readonly activity?: ActivityService;
}

const summaryOf = (state: ActivityState) => ({
  cursor: state.cursor,
  operations: Object.entries(state.counts)
    .map(([operation, count]) => ({ operation, count }))
    .sort((a, b) => b.count - a.count || a.operation.localeCompare(b.operation)),
});

type Summary = OutputOf<typeof activityOperations.summaryGet>;
type PassRecord = InputOf<typeof activityOperations.passRecord>;

export const activityHandlers: HandlerContribution<ActivityState, ActivityServices>[] = [
  {
    capability: activityOperations.summaryGet,
    handle: async (_input, ctx): Promise<Summary> => ({
      ...summaryOf(ctx.state),
      modules: [...(ctx.services.activity?.modules ?? [])],
    }),
  },
  {
    capability: activityOperations.passRecord,
    handle: async (input, ctx) => {
      const pass = input as PassRecord;
      const state = ctx.state;
      // A pass from before the recorded cursor was already counted, as after a crash between
      // the count and the record; adding it again would count those commands twice.
      if (pass.cursor > state.cursor) {
        for (const { operation, count } of pass.counted)
          state.counts[operation] = (state.counts[operation] ?? 0) + count;
        state.cursor = pass.cursor;
        ctx.change('activity:summary');
      }
      return summaryOf(state);
    },
  },
];

const known = new Set<string>(activityModule.capabilities.map((capability) => capability.id));

/**
 * Listed readers read the summary and record passes. The plugin's policy sees only its own
 * slice, so a member of the application is not a reader until this slice lists them. The record
 * command is for the counting loop, which acts as the local user narrowed to a grant.
 */
export const activityPolicy: AuthorizationPort<ActivityState> = {
  authorize({ capability, context, state }) {
    if (!known.has(capability.id)) return { allowed: false, reason: 'NO_POLICY' };
    return { allowed: state.readers.includes(context.principalId), reason: 'RESOURCE_DENIED' };
  },
  canReadEvent: () => false,
};
