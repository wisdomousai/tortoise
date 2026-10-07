import { FolderKanban } from 'lucide-react';
import { defineScreens } from '@agent-native/frame/screens';
import { ProjectsScreen } from './ui/projects';

/** The project-tasks screens the web frame renders. */
export default defineScreens({
  home: '/projects',
  routes: [{ path: 'projects', component: ProjectsScreen }],
  navigation: [{ to: '/projects', label: 'Projects', icon: FolderKanban }],
  capabilityScreens: [
    { prefix: 'project.', to: '/projects' },
    { prefix: 'task.', to: '/projects' },
  ],
});
