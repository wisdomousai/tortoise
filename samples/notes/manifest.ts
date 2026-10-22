import { defineManifest } from '@agent-native/host/manifest';
import { notesModule } from './contracts';

/** Browser-safe identity of the Notes sample. It composes no plugins. */
export default defineManifest({
  id: 'notes',
  title: 'Notes',
  modules: [notesModule],
});
