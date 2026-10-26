import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { unboundOperations } from '@agent-native/testing/ui-bindings';
import manifest from '../manifest';

test('every operation that claims a UI binding is referenced by a screen', async () => {
  // The note screens are the base sample's, and the automation and peer screens the plugins'.
  // The manifest's modules include the assignment feature's, whose operations the review screens
  // pass to the registry components.
  const roots = [
    resolve(import.meta.dir, '..'),
    resolve(import.meta.dir, '../../notes'),
    resolve(import.meta.dir, '../../../plugins/automation/ui'),
    resolve(import.meta.dir, '../../../plugins/peer-link/src/ui'),
  ];
  expect(await unboundOperations(manifest.modules, roots)).toEqual([]);
});
