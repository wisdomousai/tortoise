import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { unboundOperations } from '@agent-native/testing/ui-bindings';
import manifest from '../manifest';

test('every operation that claims a UI binding is referenced by a screen', async () => {
  // The test request screens are the base pattern's, and the peer screens the plugin's. The
  // manifest's modules include the assignment feature's, whose operations the round screens pass
  // to the registry components.
  const roots = [
    resolve(import.meta.dir, '..'),
    resolve(import.meta.dir, '../../base'),
    resolve(import.meta.dir, '../../../plugins/peer-link/src/ui'),
  ];
  expect(await unboundOperations(manifest.modules, roots)).toEqual([]);
});
