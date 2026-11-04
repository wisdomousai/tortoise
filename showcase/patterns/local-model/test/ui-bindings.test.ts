import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { unboundOperations } from '@tortoise/testing/ui-bindings';
import manifest from '../manifest';

test('every operation that claims a UI binding is referenced by a screen', async () => {
  // The test request screens are the base pattern's, and the Automation screen is the automation
  // plugin's, at /automation; both directories are searched as well.
  const roots = [
    resolve(import.meta.dir, '..'),
    resolve(import.meta.dir, '../../base'),
    resolve(import.meta.dir, '../../../../plugins/automation/ui'),
  ];
  expect(await unboundOperations(manifest.modules, roots)).toEqual([]);
});
