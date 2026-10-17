import { Inbox } from 'lucide-react';
import { defineScreens } from '@agent-native/frame/screens';
import { complianceScreens } from '@agent-native/compliance/plugin-screens';
import { webhookScreens } from '@agent-native/webhook/plugin-screens';
import manifest from './manifest';
import { ProjectList, ProjectScreen, ProjectsScreen } from './ui/projects';
import { OpenProposalCount, ProposalsScreen } from './ui/proposals';

/**
 * The project-tasks screens the web frame renders. The sidebar lists the projects; each opens at
 * its own route, so a project link survives a reload and the agent's UI session can select one.
 */
export default defineScreens({
  title: manifest.title,
  home: '/projects',
  routes: [
    { path: 'projects', component: ProjectsScreen },
    { path: 'projects/$projectId', component: ProjectScreen },
    { path: 'proposals', component: ProposalsScreen },
  ],
  // The project list in the sidebar is the main navigation; proposals and plugin sections follow.
  navigation: [{ to: '/proposals', label: 'Proposals', icon: Inbox, badge: OpenProposalCount }],
  capabilityScreens: [
    { prefix: 'project.', to: '/projects' },
    { prefix: 'task.', to: '/projects' },
    { prefix: 'proposal.', to: '/proposals' },
  ],
  sidebar: ProjectList,
  plugins: [complianceScreens, webhookScreens],
});
