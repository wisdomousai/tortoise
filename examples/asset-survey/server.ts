import type { HandlerContribution } from '@agent-native/runtime';
import type { SurveyState } from './domain';
import type { SurveyServices } from './handlers/context';
import { fieldHandlers } from './handlers/field';
import { filingHandlers } from './handlers/filing';
import { reviewHandlers } from './handlers/review';
import { structureHandlers } from './handlers/structure';

export type { SurveyServices } from './handlers/context';

/**
 * Every handler of the hub. None calls the model or the EAM: requests and filings are queued and
 * settled through commands, and EAM searches go through the remote source between pure steps.
 */
export function createSurveyHandlers(): HandlerContribution<SurveyState, SurveyServices>[] {
  return [...structureHandlers(), ...fieldHandlers(), ...reviewHandlers(), ...filingHandlers()];
}
export { surveyModules } from './contracts';
export { createSurveyState } from './domain';
export { surveyPolicy } from './policy';
