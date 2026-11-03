import type { HandlerContribution } from '@agent-native/runtime';
import type { AppState } from './domain';
import type { Services } from './handlers/context';
import { toolHandlers } from './handlers/tool';
import { loanHandlers } from './handlers/loan';
import { toolCheckOutHandlers } from './handlers/tool-check-out';
import { toolReturnHandlers } from './handlers/tool-return';
import { loanOverdueHandlers } from './handlers/loan-overdue';
import { eamHandlers } from './handlers/eam-target';
import { toolRetireHandlers } from './handlers/tool-retire';
import { toolMissingHandlers } from './handlers/tool-missing';
import { assigneeHandlers } from './handlers/assignees';
import { toolCalibrationDueHandlers } from './handlers/tool-calibration-due';
// scaffold:imports

export type { Services } from './handlers/context';
export { appPolicy } from './policy';

/** Every handler of the application: one group per collection, capability and target. */
export function createHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    ...toolHandlers(),
    ...loanHandlers(),
    ...toolCheckOutHandlers(),
    ...toolReturnHandlers(),
    ...loanOverdueHandlers(),
    ...eamHandlers(),
    ...toolRetireHandlers(),
    ...toolMissingHandlers(),
    ...assigneeHandlers(),
    ...toolCalibrationDueHandlers(),
    // scaffold:handlers
  ];
}
