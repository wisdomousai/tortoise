import { Inbox } from 'lucide-react';
import { defineScreens } from '@agent-native/frame/screens';
import { complianceScreens } from '@agent-native/compliance/plugin-screens';
import { webhookScreens } from '@agent-native/webhook/plugin-screens';
import manifest from './manifest';
import { ProjectList, ProjectScreen, ProjectsScreen } from './ui/projects';
import { PendingApprovalCount, ApprovalsScreen } from './ui/approvals';
import { projectPath, taskProjectPath } from './ui/projects/shared';

/**
 * The project-tasks screens the web frame renders. The sidebar lists the projects; each opens at
 * its own route, so a project link survives a reload and the agent's UI session can select one.
 */
export default defineScreens({
  manifest,
  title: manifest.title,
  home: '/projects',
  routes: [
    { path: 'projects', component: ProjectsScreen },
    { path: 'projects/$projectId', component: ProjectScreen },
    { path: 'approvals', component: ApprovalsScreen },
  ],
  // The project list in the sidebar is the main navigation; approval requests and plugin sections follow.
  navigation: [{ to: '/approvals', label: 'Approvals', icon: Inbox, badge: PendingApprovalCount }],
  capabilityScreens: [
    { prefix: 'project.', to: '/projects' },
    { prefix: 'task.', to: '/projects' },
    { prefix: 'approval.', to: '/approvals' },
  ],
  // Where a project or task resource opens, for OS links and agent runs alike.
  resources: { project: projectPath, task: taskProjectPath },
  sidebar: ProjectList,
  plugins: [complianceScreens, webhookScreens],
});
