import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { deploymentComponents } from '@agent-native/kernel/components';
import { unboundOperations } from '@agent-native/testing/ui-bindings';
import manifest from '../manifest';

test('every operation that claims a UI binding is referenced by a native screen', async () => {
  // The hub-link plugin routes its own pairing screen, and declares the `hub` destination that
  // captures and done marks forward to.
  const pluginScreens = resolve(import.meta.dir, '../../../plugins/hub-link/src/expo');
  expect(
    await unboundOperations(manifest.modules, [resolve(import.meta.dir, '..'), pluginScreens], {
      components: deploymentComponents(manifest),
    }),
  ).toEqual([]);
});
