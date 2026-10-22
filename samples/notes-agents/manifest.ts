import { defineManifest } from '@agent-native/host/manifest';
import { automationPluginManifest } from '@agent-native/automation/plugin-manifest';
import { notesModule } from '@agent-native/sample-notes/contracts';
import { noteTitlesModule } from './contracts';

/** The notes module, approval requests with the titler agent, and automation. Browser-safe. */
export default defineManifest({
  id: 'notes-agents',
  title: 'Notes with agents',
  modules: [notesModule, noteTitlesModule],
  plugins: [automationPluginManifest],
});
