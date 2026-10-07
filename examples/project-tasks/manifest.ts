import { defineManifest } from '@agent-native/host/manifest';
import { assuranceModule } from '@agent-native/assurance/contracts';
import { projectTasksModule } from './contracts';

/** Browser-safe identity of the project-tasks application: what generators and screens read. */
export default defineManifest({
  id: 'project-tasks',
  title: 'Projects',
  modules: [projectTasksModule, assuranceModule],
});
