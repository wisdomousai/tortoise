import { FolderKanban, ShieldCheck } from 'lucide-react';
import { defineScreens } from '@agent-native/frame/screens';
import { ProjectsScreen } from './ui/projects';
import { SecurityScreen } from '@/components/security-screen';

/** The project-tasks screens the web frame renders. */
export default defineScreens({
  home: '/projects',
  routes: [
    { path: 'projects', component: ProjectsScreen },
    { path: 'security', component: SecurityScreen },
  ],
  navigation: [
    { to: '/projects', label: 'Projects', icon: FolderKanban },
    { to: '/security', label: 'Security', icon: ShieldCheck },
  ],
  capabilityScreens: [
    { prefix: 'assurance.', to: '/security' },
    { prefix: 'project.', to: '/projects' },
    { prefix: 'task.', to: '/projects' },
  ],
});
