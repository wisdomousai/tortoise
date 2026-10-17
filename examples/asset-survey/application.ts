import { connectTarget, createRemoteSource } from '@agent-native/integration';
import { defineApplication } from '@agent-native/host/application';
import { auditPlugin } from '@agent-native/audit/plugin';
import { compliancePlugin } from '@agent-native/compliance/plugin';
import { createDeviceLinkPlugin } from '@agent-native/device-link/plugin';
import { networkPlugin } from '@agent-native/network/plugin';
import { sitePlugin } from '@agent-native/site/plugin';
import manifest from './manifest';
import { eamTarget, modelTarget, operations } from './contracts';
import {
  createExtractorPort,
  nameplateTextExtractor,
  type Extractor,
  type Proposal,
} from './connectors/extractor';
import { FakeEam, type AssetChange, type EvidenceReader } from './connectors/fake-eam';
import { createSurveyState, type Role, type SurveyState } from './domain';
import { createSurveyHandlers, surveyPolicy, type SurveyServices } from './server';

/** The model and EAM integrations' principal; distinct from every person and device. */
export const INTEGRATION_PRINCIPAL = 'integration';

/** What a paired field device may call: read its work, return it, and hand over captures. */
export const FIELD_SYNC_OPERATIONS = [
  operations.assignmentFeed.id,
  operations.assignmentReturn.id,
  operations.captureIngest.id,
];

/**
 * The asset survey hub. Demo defaults: the nameplate-text extractor instead of a model, and an
 * in-memory EAM, so the reference needs no account. A deploying application passes its own
 * extractor and EAM port. `members` are the people of a new workspace and their roles; by
 * default the owner is the only manager.
 */
export function createAssetSurveyApplication(
  options: {
    extractor?: Extractor;
    eam?: (readBlob: EvidenceReader) => FakeEam;
    services?: SurveyServices;
    members?: Record<string, Role>;
    /** Called with the connected ports, for tests that inspect or drive them. */
    onConnect?: (ports: { eam: FakeEam; model: ReturnType<typeof createExtractorPort> }) => void;
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
  return defineApplication<SurveyState, SurveyServices>({
    manifest,
    createState: state,
    upgradeState: (stored, ownerId) => (stored as SurveyState | undefined) ?? state(ownerId),
    handlers: createSurveyHandlers(),
    authorization: surveyPolicy,
    ...(options.services ? { services: options.services } : {}),
    selectableResources: { node: operations.nodeGet.id, capture: operations.captureGet.id },
    plugins: [
      sitePlugin,
      networkPlugin,
      auditPlugin,
      compliancePlugin,
      createDeviceLinkPlugin({ syncOperations: FIELD_SYNC_OPERATIONS }),
    ],
    sources: {
      eam: createRemoteSource({ target: 'eam', port: eam, credentials: eam.credentials }),
    },
    connect: ({ application, workspaceId }) => {
      const readBlob = (effect: { id: string }, digest: string) =>
        application.readEffectBlob(workspaceId, effect.id, digest);
      readEvidence = readBlob;
      const model = createExtractorPort({
        extractor: options.extractor ?? nameplateTextExtractor,
        readBlob,
      });
      options.onConnect?.({ eam, model });
      const common = { application, workspaceId, principalId: INTEGRATION_PRINCIPAL };
      return {
        integrations: [
          connectTarget<Proposal>({ ...common, target: modelTarget, port: model }),
          connectTarget<AssetChange>({ ...common, target: eamTarget, port: eam }),
        ],
      };
    },
  });
}

export default createAssetSurveyApplication();
