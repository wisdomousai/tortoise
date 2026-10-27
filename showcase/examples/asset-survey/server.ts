import type { HandlerContribution } from '@agent-native/runtime';
import type { SurveyState } from './domain';
import type { SurveyServices } from './handlers/context';
import { filingHandlers } from './handlers/filing';
import { structureHandlers } from './handlers/structure';
import { surveyHandlers } from './handlers/survey';

export type { SurveyServices } from './handlers/context';

/**
 * Every handler of the hub's own modules. None calls the model or the EAM: offers and filings
 * are queued and settled through commands, and EAM searches go through the remote source
 * between pure steps. Surveys and extractions are the assignment feature's handlers, with the
 * hooks in `handlers/survey.ts`.
 */
export function createSurveyHandlers(): HandlerContribution<SurveyState, SurveyServices>[] {
  return [...structureHandlers(), ...surveyHandlers(), ...filingHandlers()];
}
export { surveyModules } from './contracts';
export { createSurveyState } from './domain';
export { proposalAccess, surveyAccess, surveyPolicy } from './policy';
export { surveyHooks } from './handlers/survey';
