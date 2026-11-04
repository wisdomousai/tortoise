import { expect, test } from 'bun:test';
import { dirname, resolve } from 'node:path';
import { unboundOperations } from '@tortoise/testing/ui-bindings';
import manifest from '../manifest';

test('every operation that claims a UI binding is referenced by a screen', async () => {
  // The default collection screens come from the frame, and the enrollment screen from the
  // device-link plugin, resolved as a package so it is found as a workspace or installed alike.
  const deviceLink = dirname(
    Bun.resolveSync('@tortoise/device-link/plugin-screens', import.meta.dir),
  );
  expect(
    await unboundOperations(
      manifest.modules,
      [resolve(import.meta.dir, '..'), resolve(deviceLink, 'ui')],
      { components: manifest.components },
    ),
  ).toEqual([]);
});
