import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { unboundOperations } from '@agent-native/testing/ui-bindings';
import manifest from '../manifest';

test('every operation that claims a UI binding is referenced by a screen', async () => {
  // The test request screens are the base pattern's, and the terminal and badge screens are the
  // sign-in workstation's; both directories are searched as well.
  const roots = [
    resolve(import.meta.dir, '..'),
    resolve(import.meta.dir, '../../lab-requests'),
    resolve(import.meta.dir, '../../../workstations/sign-in/src'),
  ];
  expect(await unboundOperations(manifest.modules, roots)).toEqual([]);
});
