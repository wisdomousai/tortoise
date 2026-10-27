import { connectTarget, createRemoteSource } from '@agent-native/integration';
import { approvalFeature, type ApprovalAccess, type ApprovalHooks } from '@agent-native/runtime';
import {
  assignmentFeature,
  type AssignmentAccess,
  type AssignmentHooks,
} from '@agent-native/assignments/server';
import { defineApplication } from '@agent-native/host/application';
import { mountFeature } from '@agent-native/host/feature';
import { auditPlugin } from '@agent-native/audit/plugin';
import { compliancePlugin } from '@agent-native/compliance/plugin';
import { createDeviceLinkPlugin } from '@agent-native/device-link/plugin';
import { networkPlugin } from '@agent-native/network/plugin';
import { processPlugin } from '@agent-native/process/plugin';
import { bunProcesses, type NetworkPort } from '@agent-native/host/plugin';
import { sitePlugin } from '@agent-native/site/plugin';
import { createWorkflowsPlugin, type WorkflowsOptions } from '@agent-native/workflows/plugin';
import manifest from './manifest';
import { assignments, eamTarget, exportTarget, operations, structureOperations } from './contracts';
import {
  createExtractionPort,
  nameplateTextExtractor,
  type ExtractionPort,
  type Extractor,
} from './connectors/extractor';
import { FakeEam, type AssetChange, type EvidenceReader } from './connectors/fake-eam';
import { modelExtractorFromEnv } from './connectors/model-extractor';
import { createExportPort } from './export/connector';
import { createSurveyState, type Role, type SurveyState } from './domain';
import { adoptAssignments, migrations } from './migration';
import {
  createSurveyHandlers,
  proposalAccess,
  surveyAccess,
  surveyHooks,
  surveyPolicy,
  type SurveyServices,
} from './server';

/** The model, EAM and export integrations' principal; distinct from every person and device. */
export const INTEGRATION_PRINCIPAL = 'integration';

/** What a paired field device may call: the device assignee operations of the survey assignments. */
export const FIELD_SYNC_OPERATIONS = assignments.assignees.device.operations;

/**
 * The asset survey hub. Demo defaults: the nameplate-text extractor instead of a model, and an
 * in-memory EAM, so the reference needs no account. Exports go to the directory the site binds
 * the `filing-export` process to; unbound, they wait. A deploying application passes its own
 * extractor and EAM port. `members` are the people of a new workspace and their roles; by
 * default the owner is the only manager.
 */
export function createAssetSurveyApplication(
  options: {
    /** An extractor, or one built from the network port when it calls a declared destination. */
    extractor?: Extractor | ((network: NetworkPort) => Extractor);
    eam?: (readBlob: EvidenceReader) => FakeEam;
    services?: SurveyServices;
    members?: Record<string, Role>;
    /** The workflows plugin's clock and runner interval. */
    workflows?: WorkflowsOptions;
    /** Called with the connected ports, for tests that inspect or drive them. */
    onConnect?: (ports: { eam: FakeEam; model: ExtractionPort }) => void;
  } = {},
) {
  const state = (ownerId: string) =>
    createSurveyState({
      ownerId,
      integrationPrincipalId: INTEGRATION_PRINCIPAL,
      ...(options.members ? { members: options.members } : {}),
    });
  // The EAM port exists before a workspace opens, so live searches have a source; it reads
  // evidence photos through the application once `connect` has bound it.
  let readEvidence: EvidenceReader = async () => undefined;
  const reader: EvidenceReader = (effect, digest) => readEvidence(effect, digest);
  const eam = options.eam ? options.eam(reader) : new FakeEam(reader);
  const extractor = options.extractor ?? nameplateTextExtractor;
  return defineApplication<SurveyState, SurveyServices>({
    manifest,
    createState: state,
    migrations,
    upgradeState: (stored, ownerId) => ({
      ...state(ownerId),
      ...(stored as Partial<SurveyState> | undefined),
    }),
    handlers: createSurveyHandlers(),
    authorization: surveyPolicy,
    features: [
      mountFeature<SurveyState, AssignmentAccess, AssignmentHooks, SurveyServices>(
        assignmentFeature(assignments, {
          targets: {
            model: {
              principalId: INTEGRATION_PRINCIPAL,
              // The assignment feature connects the model target when a workspace opens.
              port: ({ readBlob, network }) => {
                const model = createExtractionPort({
                  extractor: typeof extractor === 'function' ? extractor(network) : extractor,
                  readBlob,
                });
                options.onConnect?.({ eam, model });
                return model;
              },
            },
          },
        }),
        // Version 1 kept field work, captures and extractions in the application's own records.
        { access: surveyAccess, hooks: surveyHooks, adopt: { before: 2, from: adoptAssignments } },
      ),
      // Agents preparing the structure request node creations; a manager approves each.
      mountFeature<SurveyState, ApprovalAccess, ApprovalHooks, SurveyServices>(
        approvalFeature({ commands: [structureOperations.nodeCreate] }),
        { access: proposalAccess, hooks: { newId: surveyHooks.newId, now: surveyHooks.now } },
      ),
    ],
    ...(options.services ? { services: options.services } : {}),
    selectableResources: {
      node: operations.nodeGet.id,
      capture: operations.captureGet.id,
      assignment: operations.get.id,
      'assignment-report': operations.reportGet.id,
    },
    plugins: [
      sitePlugin,
      networkPlugin,
      processPlugin,
      auditPlugin,
      compliancePlugin,
      createDeviceLinkPlugin({ syncOperations: FIELD_SYNC_OPERATIONS }),
      createWorkflowsPlugin(options.workflows),
    ],
    sources: {
      eam: createRemoteSource({ target: 'eam', port: eam, credentials: eam.credentials }),
    },
    connect: ({ application, workspaceId, processes }) => {
      const readBlob = (effect: { id: string }, digest: string) =>
        application.readEffectBlob(workspaceId, effect.id, digest);
      readEvidence = readBlob;
      const common = { application, workspaceId, principalId: INTEGRATION_PRINCIPAL };
      return {
        integrations: [
          connectTarget<AssetChange>({ ...common, target: eamTarget, port: eam }),
          // Unbound, the export target keeps its filings pending until the site binds the process.
          connectTarget({
            ...common,
            target: exportTarget,
            port: createExportPort({
              start: (signal) => bunProcesses(processes)('filing-export', { signal }),
              readBlob,
            }),
          }),
        ],
      };
    },
  });
}

/** The demo hub; `ASSET_SURVEY_MODEL` opts into live extraction (see `modelExtractorFromEnv`). */
const live = modelExtractorFromEnv();
export default createAssetSurveyApplication(live ? { extractor: live } : {});
