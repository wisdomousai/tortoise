import { expect, test } from 'bun:test';
import { dirname, resolve } from 'node:path';
import { unboundOperations } from '@agent-native/testing/ui-bindings';
import manifest from '../manifest';

test('every operation that claims a UI binding is referenced by a screen', async () => {
  // The default collection screens and the Compliance screen come from the frame and the
  // compliance plugin; the application passes them its capabilities. The badge screen of the
  // station sign-in plugin binds the plugin's operations, which the manifest composes. Plugins are
  // resolved as packages, so they are found as workspaces or as installed versions alike.
  const compliance = dirname(
    Bun.resolveSync('@agent-native/compliance/plugin-screens', import.meta.dir),
  );
  const signIn = dirname(
    Bun.resolveSync('@agent-native/workstation-sign-in/plugin-screens', import.meta.dir),
  );
  expect(
    await unboundOperations(manifest.modules, [
      resolve(import.meta.dir, '..'),
      resolve(compliance, 'components/compliance-screen.tsx'),
      signIn,
    ]),
  ).toEqual([]);
});
