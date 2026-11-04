import { expect, test } from 'bun:test';
import { dirname, resolve } from 'node:path';
import { unboundOperations } from '@tortoise/testing/ui-bindings';
import manifest from '../manifest';

test('every operation that claims a UI binding is referenced by a screen', async () => {
  // The default collection screens and the Compliance and Peers screens come from the frame
  // and the plugins; the application passes them its capabilities. The plugin is resolved as
  // a package, so it is found as a workspace or as an installed version alike.
  const compliance = dirname(
    Bun.resolveSync('@tortoise/compliance/plugin-screens', import.meta.dir),
  );
  const peers = dirname(Bun.resolveSync('@tortoise/peer-link/plugin-screens', import.meta.dir));
  expect(
    await unboundOperations(
      manifest.modules,
      [
        resolve(import.meta.dir, '..'),
        resolve(compliance, 'components/compliance-screen.tsx'),
        resolve(peers, 'ui/peers.tsx'),
      ],
      { components: manifest.components },
    ),
  ).toEqual([]);
});
