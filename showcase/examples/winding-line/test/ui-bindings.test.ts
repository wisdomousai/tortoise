import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { unboundOperations } from '@tortoise/testing/ui-bindings';
import manifest from '../manifest';

test('every operation that claims a UI binding is referenced by a screen', async () => {
  // The Compliance screen comes from the compliance plugin, which routes it at /compliance.
  const securityScreen = resolve(
    import.meta.dir,
    '../../../../plugins/compliance/src/components/compliance-screen.tsx',
  );
  // The Automation screen comes from the automation plugin, at /automation.
  const automationScreen = resolve(import.meta.dir, '../../../../plugins/automation/ui');
  // The Drivers screen comes from the driver plugin, at /drivers.
  const driverScreen = resolve(
    import.meta.dir,
    '../../../../plugins/connector-driver/src/components/driver-screen.tsx',
  );
  expect(
    await unboundOperations(manifest.modules, [
      resolve(import.meta.dir, '..'),
      securityScreen,
      automationScreen,
      driverScreen,
    ]),
  ).toEqual([]);
});
