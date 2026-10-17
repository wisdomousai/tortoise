import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { unboundOperations } from '@agent-native/testing/ui-bindings';
import manifest from '../manifest';

test('every operation that claims a UI binding is referenced by a screen', async () => {
  // The default collection screens and the Compliance screen come from the frame and the
  // compliance plugin; the application passes them its capabilities.
  const root = resolve(import.meta.dir, '../../..');
  expect(
    await unboundOperations(manifest.modules, [
      resolve(import.meta.dir, '..'),
      resolve(root, 'plugins/compliance/src/components/compliance-screen.tsx'),
    ]),
  ).toEqual([]);
});
