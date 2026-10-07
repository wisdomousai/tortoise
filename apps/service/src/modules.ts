import { projectTasksModule } from '../../../examples/project-tasks/contracts';
import { qualityInspectionModule } from '../../../examples/quality-inspection/contracts';
import { lineStationModule } from '../../../examples/line-station/contracts';
import { deviceConfigModule } from '@agent-native/devices/contracts';
import { assuranceModule } from '@agent-native/assurance/contracts';

/**
 * The application's capability modules. Pure contracts only: generators and browser code may
 * import this without loading handlers, storage, credentials or provider SDKs.
 */
export const applicationModules = [
  projectTasksModule,
  qualityInspectionModule,
  lineStationModule,
  deviceConfigModule,
  assuranceModule,
] as const;
