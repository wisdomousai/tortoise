import { defineModule } from '@tortoise/contracts';
import { captureOperations } from './contracts/captures';
import { assignmentOperations } from './contracts/kinds';
import { eamAssets, eamTarget, exportTarget, filingOperations } from './contracts/filing';
import { structureOperations } from './contracts/structure';
import { captureFileWorkflow, captureToEam } from './contracts/workflow';

export { captureOperations } from './contracts/captures';
export {
  assignmentOperations,
  assignments,
  modelTarget,
  ATTENTION_BELOW,
  extraction,
  reportLink,
  survey,
} from './contracts/kinds';
export { eamAssets, eamTarget, exportTarget, filingOperations } from './contracts/filing';
export { documents, nodes, structureOperations } from './contracts/structure';
export { captureFileWorkflow, captureToEam } from './contracts/workflow';

/** Every operation of the hub by short name, for screens and tests, the assignments' included. */
export const operations = {
  ...structureOperations,
  ...captureOperations,
  ...assignmentOperations,
  filingFile: filingOperations.file,
  filingWithdraw: filingOperations.withdraw,
  filingList: filingOperations.list,
  filingStatus: filingOperations.status,
  filingExport: filingOperations.export,
  filingExportStatus: filingOperations.exportStatus,
  captureFileWorkflow,
} as const;

export const structureModule = defineModule({
  id: 'survey-structure',
  capabilities: Object.values(structureOperations),
  workflows: [
    {
      id: 'prepare-structure',
      operations: ['structure.tree', 'structure.node.search', 'document.list', 'approval.request'],
      text: 'Read structure.tree and the documents of the area. For each object a schematic or plan shows that the tree lacks, check structure.node.search for its designation, then request approval for structure.node.create under the right parent, naming the document in the rationale. A manager approves each request; never create nodes yourself.',
    },
  ],
});

/** Captures are survey reports; the extraction model is the assignments' `model` target. */
export const reviewModule = defineModule({
  id: 'survey-review',
  capabilities: Object.values(captureOperations),
  requirements: {
    network: [
      {
        id: 'model-api',
        purpose:
          'Send capture photos to the extraction model and read back the values it proposes.',
        direction: 'outbound',
        scope: 'internet',
        protocol: 'https',
        targets: ['assignment-model'],
        dataClasses: ['equipment-photo', 'nameplate-values'],
        availability: 'optional',
        offline: 'queue',
      },
    ],
  },
  workflows: [
    {
      id: 'review-captures',
      operations: [
        'capture.list',
        'capture.get',
        'structure.node.search',
        'assignment.report.link',
        'assignment.extraction.create',
        'assignment.extraction.accept',
        'assignment.report.discard',
      ],
      text: 'Work through capture.list with review new. Open each with capture.get. Link an unlinked capture with assignment.report.link after finding its node through structure.node.search on a scanned code or the designation on the photo. Send a nameplate without a reading to the model with assignment.extraction.create, scope reportId and assignee the model target. When the reading is recorded, compare every value flagged attention with the photo region and correct what is wrong; then a person accepts it with assignment.extraction.accept. An agent prepares and reports which captures are ready and which values it doubts; it cannot accept. Discard unusable captures with assignment.report.discard and the reason.',
    },
  ],
});

export const filingModule = defineModule({
  id: 'survey-filing',
  capabilities: [
    ...eamAssets.capabilities,
    filingOperations.file,
    filingOperations.withdraw,
    filingOperations.export,
    filingOperations.list,
    captureFileWorkflow,
    ...eamTarget.capabilities,
    ...exportTarget.capabilities,
  ],
  requirements: {
    network: [
      {
        id: 'eam-api',
        purpose:
          'Search assets in the enterprise asset management system, file surveyed nodes with their attributes and photos, and read back the assets filed.',
        direction: 'outbound',
        scope: 'local',
        protocol: 'https',
        targets: ['eam'],
        reads: ['eam'],
        dataClasses: ['asset-record', 'equipment-photo'],
        availability: 'optional',
        offline: 'queue',
      },
    ],
    processes: [
      {
        id: 'filing-export',
        executable: 'filing-export',
        purpose:
          'Write each exported filing as a folder of JSON and evidence photos into the directory the deployment policy binds as its argument.',
        availability: 'optional',
        targets: ['export'],
      },
    ],
  },
  workflows: [
    {
      id: 'file-assets',
      operations: [
        'structure.node.get',
        'eam.asset.search',
        'filing.file',
        'filing.list',
        'filing.status',
      ],
      text: 'For each node with accepted attributes, read structure.node.get, then search eam.asset.search by its designation and its serial. File with filing.file and the matching assetId to update, or without one to create. If the search is unavailable, do not file: an unchecked create can duplicate an asset. Afterwards read filing.list and explain every rejection; do not file the same node again until the cause is fixed.',
    },
    captureToEam,
  ],
});

export const surveyModules = [structureModule, reviewModule, filingModule];
