import { Workflow } from 'lucide-react';
import { definePluginScreens } from '@tortoise/frame/plugin-screens';
import { WorkflowsScreen } from './ui/workflows';

/** The workflows screen, its sidebar entry and the palette target for `workflow.*`. */
export const workflowsScreens = definePluginScreens({
  id: 'workflow',
  routes: [{ path: 'workflows', component: WorkflowsScreen }],
  navigation: [{ to: '/workflows', label: 'Workflows', icon: Workflow }],
  capabilityScreens: [{ prefix: 'workflow.', to: '/workflows' }],
});
