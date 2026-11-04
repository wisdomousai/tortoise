import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { unboundOperations } from '@tortoise/testing/ui-bindings';
import manifest from '../manifest';

test('every operation that claims a UI binding is referenced by a screen', async () => {
  // The screens are the base pattern's, so its directory is searched as well.
  const roots = [resolve(import.meta.dir, '..'), resolve(import.meta.dir, '../../base')];
  expect(await unboundOperations(manifest.modules, roots)).toEqual([]);
});
