import { targetRules } from '@agent-native/integration';
import {
  definePolicy,
  isDelegated,
  type ApprovalAccess,
  type OperationRule,
} from '@agent-native/runtime';
import type { AssignmentAccess } from '@agent-native/assignments/server';
import { eamAssets, eamTarget, exportTarget, operations } from './contracts';
import { deviceIdOf, roleOf, type Role, type SurveyState } from './domain';

/** The whole survey is one container; a member's role there decides. */
const SURVEY = 'survey';
const inSurvey = (roles?: Role[]): OperationRule<SurveyState, Role> => ({
  container: () => SURVEY,
  ...(roles ? { roles } : {}),
});
const read = inSurvey();
const manage = inSurvey(['manager']);
const review = inSurvey(['manager', 'reviewer']);

/**
 * Who does what in a survey. Managers plan the structure and the field work and file; reviewers
 * place captures, send them to be read and accept the readings; viewers read. The integration
 * principal settles and syncs the EAM and export targets and nothing else. Assignments and
 * approval requests are features, which the access views below answer for.
 */
export const surveyPolicy = definePolicy<SurveyState, Role>({
  roleOf: (state, principalId) => roleOf(state, principalId),
  integrations: [
    {
      is: (state, principalId) => principalId === state.integrationPrincipalId,
      operations: [...eamTarget.integrationOperations, ...exportTarget.integrationOperations],
    },
  ],
  caller: { allow: (state, context) => roleOf(state, context.principalId) !== undefined },
  operations: {
    ...targetRules(eamTarget),
    ...targetRules(exportTarget),
    [operations.nodeCreate.id]: manage,
    [operations.nodeUpdate.id]: manage,
    [operations.nodeMove.id]: manage,
    [operations.nodeRetire.id]: manage,
    [operations.tree.id]: read,
    [operations.nodeGet.id]: read,
    [operations.nodeSearch.id]: read,
    [operations.documentCreate.id]: manage,
    [operations.documentList.id]: read,
    [operations.captureList.id]: read,
    [operations.captureGet.id]: read,
    // Each nested call is authorized on its own as well; this rule admits the composite.
    [operations.placeAndExtract.id]: review,
    [operations.assigneeList.id]: read,
    [operations.filingFile.id]: manage,
    [operations.filingExport.id]: manage,
    [operations.filingWithdraw.id]: manage,
    // Starting the workflow is a manager's; each step is authorized as them when it runs.
    [operations.captureFileWorkflow.id]: manage,
    [operations.filingList.id]: read,
    [eamAssets.search.id]: read,
    [eamAssets.lookup.id]: read,
  },
  // `capture` and `extraction` are version 1's resources: their journal and the photos attached
  // to an adopted capture stay readable to members, as they were.
  events: Object.fromEntries(
    ['node', 'document', 'filing', 'sync', 'capture', 'extraction'].map((type) => [
      type,
      (_id: string, state: SurveyState, context: { principalId: string }) =>
        roleOf(state, context.principalId) !== undefined,
    ]),
  ),
});

/**
 * Who may do what with surveys and extractions. The feature never consults the policy above,
 * so this repeats its membership gate.
 *
 * - A paired device (`device:<id>`) only works on the surveys sent to it; device link
 *   authenticates it, and revoking it refuses its next request.
 * - The integration principal settles offers to the model and applies its readings.
 * - Members read. Managers and reviewers take work sent to them and review reports; managers
 *   plan surveys, and reviewers may also send a capture to be read. Accepting is person-only.
 */
export const surveyAccess = (state: SurveyState): AssignmentAccess => ({
  allows(context, action, scope) {
    if (context.peer) return false;
    if (deviceIdOf(context.principalId) !== undefined)
      return action === 'work' && (scope === undefined || scope === 'survey');
    if (context.principalId === state.integrationPrincipalId)
      return action === 'integrate' && scope === 'model';
    const role = roleOf(state, context.principalId);
    if (!role) return false;
    switch (action) {
      case 'read':
        return true;
      case 'work':
      case 'review':
        return role !== 'viewer';
      case 'plan':
        return role === 'manager' || (role === 'reviewer' && scope === 'extraction');
      case 'integrate':
        return false;
    }
  },
});

/**
 * Who may do what with approval requests for structure changes: members read them, managers
 * and reviewers (and agents acting for them) request them, and a manager decides.
 */
export const proposalAccess = (state: SurveyState): ApprovalAccess => ({
  allows(context, action) {
    if (context.peer) return false;
    const role = roleOf(state, context.principalId);
    if (!role) return false;
    if (action === 'read') return true;
    if (action === 'request') return role !== 'viewer';
    return role === 'manager' && !isDelegated(context);
  },
});
