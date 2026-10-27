import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { unboundOperations } from '@agent-native/testing/ui-bindings';
import manifest from '../manifest';

test('every operation that claims a UI binding is referenced by a screen', async () => {
  // The Compliance, Drivers and Peers screens come from their plugins, which route them.
  const plugins = resolve(import.meta.dir, '../../../../plugins');
  expect(
    await unboundOperations(manifest.modules, [
      resolve(import.meta.dir, '..'),
      resolve(plugins, 'compliance/src/components/compliance-screen.tsx'),
      resolve(plugins, 'connector-driver/src/components/driver-screen.tsx'),
      resolve(plugins, 'peer-link/src/ui/peers.tsx'),
    ]),
  ).toEqual([]);
});
