import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { unboundOperations } from '@agent-native/testing/ui-bindings';
import manifest from '../manifest';

test('every operation that claims a UI binding is referenced by a screen', async () => {
  // The Compliance screen comes from the compliance plugin, which routes it at /compliance.
  const securityScreen = resolve(
    import.meta.dir,
    '../../../../plugins/compliance/src/components/compliance-screen.tsx',
  );
  // The webhook plugin brings its own screens.
  const webhookScreens = resolve(import.meta.dir, '../../../../plugins/webhook/ui');
  expect(
    await unboundOperations(manifest.modules, [
      resolve(import.meta.dir, '..'),
      securityScreen,
      webhookScreens,
    ]),
  ).toEqual([]);
});
