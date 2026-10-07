import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { unboundOperations } from '@agent-native/testing/ui-bindings';
import manifest from '../manifest';

test('every operation that claims a UI binding is referenced by a screen', async () => {
  expect(await unboundOperations(manifest.modules, resolve(import.meta.dir, '..'))).toEqual([]);
});
