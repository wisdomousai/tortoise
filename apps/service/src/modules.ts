import { projectTasksModule } from '../../../examples/project-tasks/contracts';
import { qualityInspectionModule } from '../../../examples/quality-inspection/contracts';

/**
 * The application's capability modules. Pure contracts only: generators and browser code may
 * import this without loading handlers, storage, credentials or provider SDKs.
 */
export const applicationModules = [projectTasksModule, qualityInspectionModule] as const;
