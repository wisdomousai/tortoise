import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { unboundOperations } from '@agent-native/testing/ui-bindings';
import manifest from '../manifest';

test('every operation that claims a UI binding is referenced by a screen', async () => {
  // The shared Security screen comes from the frame; this application routes it at /security.
  const securityScreen = resolve(
    import.meta.dir,
    '../../../packages/frame/src/components/security-screen.tsx',
  );
  expect(
    await unboundOperations(manifest.modules, [resolve(import.meta.dir, '..'), securityScreen]),
  ).toEqual([]);
});
