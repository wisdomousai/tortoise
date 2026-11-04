import { defineAssignments } from '@tortoise/assignments';
import { cycleCount } from './cycle-count-assignment';
// scaffold:imports

/** The application's assignment kinds and the operations generated for them. Browser-safe. */
export const assignments = defineAssignments({
  kinds: [
    cycleCount,
    // scaffold:assignment-kinds
  ],
});

/** The generated operations, flat, so screens bind them by name. */
export const assignmentOperations = assignments.operations;
