import { byKind } from '@agent-native/assignments/server';
import { newId, now, type Context } from './context';
import { cycleCountHooks } from './cycle-count-assignment';
// scaffold:imports

/** The hooks of every assignment kind, for the assignment feature's mount. */
export const assignmentHooks = {
  newId: (ctx: Context) => newId(ctx),
  now: (ctx: Context) => now(ctx),
  ...byKind<Context>({
    'cycle-count': cycleCountHooks,
    // scaffold:assignment-hooks
  }),
};
