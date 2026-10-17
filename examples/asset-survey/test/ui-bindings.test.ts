import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { unboundOperations } from '@agent-native/testing/ui-bindings';
import manifest from '../manifest';

test('every operation that claims a UI binding is referenced by a screen', async () => {
  // The compliance and device-link plugins route their own screens.
  const pluginScreens = [
    '../../../plugins/compliance/src/components/compliance-screen.tsx',
    '../../../plugins/device-link/src/ui',
  ].map((path) => resolve(import.meta.dir, path));
  expect(
    await unboundOperations(manifest.modules, [resolve(import.meta.dir, '..'), ...pluginScreens]),
  ).toEqual([]);
});
