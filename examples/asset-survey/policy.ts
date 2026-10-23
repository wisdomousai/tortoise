import { targetRules } from '@agent-native/integration';
import { definePolicy, type OperationRule } from '@agent-native/runtime';
import { eamAssets, eamTarget, exportTarget, modelTarget, operations } from './contracts';
import { DEVICE_PREFIX, roleOf, type Role, type SurveyState } from './domain';

/** The whole survey is one container; a member's role there decides. */
const SURVEY = 'survey';
const inSurvey = (roles?: Role[], person?: boolean): OperationRule<SurveyState, Role> => ({
  container: () => SURVEY,
  ...(roles ? { roles } : {}),
  ...(person ? { person } : {}),
});
const read = inSurvey();
const manage = inSurvey(['manager']);
const review = inSurvey(['manager', 'reviewer']);

/**
 * Who does what in a survey. Managers plan the structure and the field work and file; reviewers
 * place captures, request extractions and accept them; viewers read. Accepting a proposal (a
 * node or extracted values) is a person's decision, never a delegated agent's. Paired field
 * devices (`device:<id>`) may only read their assignments, return them and hand over captures;
 * the device-link plugin authenticates them and revoking one refuses its next request. The
 * integration principal settles and syncs the model, EAM and export targets and nothing else.
 */
export const surveyPolicy = definePolicy<SurveyState, Role>({
  roleOf: (state, principalId) => roleOf(state, principalId),
  integrations: [
    // One principal runs both connectors, and the first lane that matches a caller decides.
    {
      is: (state, principalId) => principalId === state.integrationPrincipalId,
      operations: [
        ...modelTarget.integrationOperations,
        ...eamTarget.integrationOperations,
        ...exportTarget.integrationOperations,
      ],
    },
    {
      is: (_state, principalId) => principalId.startsWith(DEVICE_PREFIX),
      operations: [
        operations.assignmentFeed.id,
        operations.assignmentReturn.id,
        operations.captureIngest.id,
      ],
      // A device reads no journal: it learns of new work through its feed.
      events: () => false,
    },
  ],
  caller: { allow: (state, context) => roleOf(state, context.principalId) !== undefined },
  operations: {
    ...targetRules(modelTarget),
    ...targetRules(eamTarget),
    ...targetRules(exportTarget),
    [operations.nodeCreate.id]: manage,
    [operations.nodeUpdate.id]: manage,
    [operations.nodeMove.id]: manage,
    [operations.nodeRetire.id]: manage,
    [operations.nodeAccept.id]: inSurvey(['manager'], true),
    [operations.nodePropose.id]: review,
    [operations.tree.id]: read,
    [operations.nodeGet.id]: read,
    [operations.nodeSearch.id]: read,
    [operations.documentAdd.id]: manage,
    [operations.documentList.id]: read,
    [operations.assignmentCreate.id]: manage,
    [operations.assignmentDispatch.id]: manage,
    [operations.assignmentList.id]: read,
    // A person returns an assignment for a lost device; the device itself through its lane.
    [operations.assignmentReturn.id]: manage,
    [operations.assignmentFeed.id]: 'integration',
    [operations.captureIngest.id]: 'integration',
    [operations.captureList.id]: read,
    [operations.captureGet.id]: read,
    [operations.capturePlace.id]: review,
    [operations.captureDiscard.id]: review,
    [operations.extractionRequest.id]: review,
    // Each nested call is authorized on its own as well; this rule admits the composite.
    [operations.capturePlaceAndExtract.id]: review,
    [operations.extractionAccept.id]: inSurvey(['manager', 'reviewer'], true),
    [operations.filingFile.id]: manage,
    [operations.filingExport.id]: manage,
    [operations.filingList.id]: read,
    [eamAssets.search.id]: read,
    [eamAssets.lookup.id]: read,
  },
  events: Object.fromEntries(
    ['node', 'document', 'assignment', 'capture', 'extraction', 'filing', 'sync'].map((type) => [
      type,
      (_id: string, state: SurveyState, context: { principalId: string }) =>
        roleOf(state, context.principalId) !== undefined,
    ]),
  ),
});
