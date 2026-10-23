import { defineModule } from '@agent-native/contracts';
import { arrivalOperations } from './contracts/arrivals';
import { commandOperations } from './contracts/commands';
import { queryOperations } from './contracts/queries';

export {
  captureTelemetrySchema,
  plantRoleSchema,
  characteristicSchema,
  resultSchema,
  defectSchema,
  decisionSchema,
  lotSummarySchema,
  lotDetailSchema,
  codeGroupSchema,
  lotSnapshotSchema,
} from './contracts/schemas';
export { qualityTarget } from './contracts/target';

export const operations = {
  ...queryOperations,
  ...commandOperations,
  ...arrivalOperations,
} as const;

export const qualityInspectionModule = defineModule({
  id: 'quality-inspection',
  capabilities: Object.values(operations),
  requirements: {
    network: [
      {
        id: 'quality-system-api',
        purpose:
          'Forward results, defects and usage decisions to the quality system and pull lots and characteristics from it.',
        direction: 'egress',
        scope: 'site',
        protocol: 'https',
        targets: ['quality-system'],
        dataClasses: ['inspection-result', 'defect', 'usage-decision'],
        availability: 'required',
        offline: 'queue',
      },
    ],
  },
  workflows: [
    {
      id: 'inspect-lot',
      operations: [
        'inspection.lot.list',
        'inspection.worklist',
        'inspection.lot.get',
        'inspection.result.record-batch',
        'inspection.result.record',
        'inspection.defect.record',
      ],
      text: 'Find the open lot, read its characteristics and limits, then record each measurement for the sample named by the worklist. For an instrument export, map rows to characteristics and samples and submit them with record-batch in one commit; never invent values that are not in the source. Use the measurement time from the source as occurredAt. Report out-of-tolerance results and record a defect only when the source states one. Leave the usage decision to a supervisor.',
    },
    {
      id: 'triage-rejections',
      operations: ['inspection.sync.status', 'inspection.lot.get', 'inspection.result.correct'],
      text: 'Read rejected records from sync status, inspect the lot and the rejection reason, and explain each one. Correct a result only when the reason identifies a clear entry error and the correct value is known; supply that reason. Otherwise ask the user. A correction is forwarded again and may itself be rejected.',
    },
  ],
});
