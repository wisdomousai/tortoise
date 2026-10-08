import { ShieldCheck } from 'lucide-react';
import { defineScreens } from '@agent-native/frame/screens';
import manifest from './manifest';
import { ProjectList, ProjectScreen, ProjectsScreen } from './ui/projects';
import { SecurityScreen } from '@/components/security-screen';

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
    { path: 'security', component: SecurityScreen },
  ],
  // The project list in the sidebar is the main navigation; sections follow it.
  navigation: [{ to: '/security', label: 'Security', icon: ShieldCheck }],
  capabilityScreens: [
    { prefix: 'assurance.', to: '/security' },
    { prefix: 'project.', to: '/projects' },
    { prefix: 'task.', to: '/projects' },
  ],
  sidebar: ProjectList,
});
