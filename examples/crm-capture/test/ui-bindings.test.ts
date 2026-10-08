import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { unboundOperations } from '@agent-native/testing/ui-bindings';
import manifest from '../manifest';

test('every operation that claims a UI binding is referenced by a screen', async () => {
  // The Security screen comes from the assurance plugin, which routes it at /security.
  const securityScreen = resolve(
    import.meta.dir,
    '../../../plugins/assurance/src/components/security-screen.tsx',
  );
  expect(
    await unboundOperations(manifest.modules, [resolve(import.meta.dir, '..'), securityScreen]),
  ).toEqual([]);
});
