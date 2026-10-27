import type { HandlerContribution } from '@agent-native/runtime';
import type { QualityState } from './domain';
import { inspectionRequestHandlers } from './handlers/inspection-requests';
import { captureHandlers } from './handlers/capture';
import { instrumentHandlers } from './handlers/instrument';
import { integrationHandlers } from './handlers/integration';
import { lotHandlers } from './handlers/lots';
import { reportHandlers } from './handlers/reports';
import { supervisionHandlers } from './handlers/supervision';
import type { QualityServices } from './server/context';

export { DEFECT_CODE_GROUP, type QualityServices } from './server/context';

/** Domain handlers never call the SoR; forwarding is queued and completed through commands. */
export function createQualityHandlers(): HandlerContribution<QualityState, QualityServices>[] {
  return [
    ...lotHandlers(),
    ...reportHandlers(),
    ...captureHandlers(),
    ...supervisionHandlers(),
    ...integrationHandlers(),
    ...instrumentHandlers(),
    ...inspectionRequestHandlers(),
  ];
}
export { qualityInspectionModule } from './contracts';
export { createQualityState } from './domain';
export { qualityPolicy } from './policy';
