import { expect, test } from 'bun:test';
import { LOCAL_USER, LOCAL_WORKSPACE } from '@tortoise/kernel/instance';
import { createApplicationRuntime, defineApplication } from '@tortoise/kernel/application';
import { defineManifest } from '@tortoise/kernel/manifest';
import { createMemoryStorage } from '@tortoise/runtime';
import { directDriver, runScenarios, type BehavioralScenario } from '@tortoise/testing/scenarios';
import { hubLinkOperations as ops } from '../src/contracts';
import { hubLinkPlugin } from '../src/plugin';
import { hubLinkPluginManifest } from '../src/plugin-manifest';

const localUser = { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_USER };
const pairing = {
  origin: 'https://hub.site.example',
  deviceId: 'd-1',
  label: 'Phone',
  kind: 'field-sync',
  pairedAt: 1_000,
};

const scenarios: BehavioralScenario[] = [
  {
    name: 'the holder records an error, then a pairing, then clears it; nobody else reads it',
    async run(driver) {
      const get = async () =>
        (await driver.query({ operation: ops.pairingGet.id, input: {} }, localUser)).data;
      expect(await get()).toEqual({ pairing: null });
      await driver.command(
        { operation: ops.pairingRecord.id, input: { error: 'Code expired' }, idempotencyKey: 'e' },
        localUser,
      );
      expect(await get()).toEqual({ pairing: null, lastError: 'Code expired' });
      await driver.command(
        { operation: ops.pairingRecord.id, input: { pairing }, idempotencyKey: 'p' },
        localUser,
      );
      expect(await get()).toEqual({ pairing });
      await driver.command(
        { operation: ops.pairingClear.id, input: {}, idempotencyKey: 'c' },
        localUser,
      );
      expect(await get()).toEqual({ pairing: null });
      await expect(
        driver.query(
          { operation: ops.pairingGet.id, input: {} },
          { ...localUser, principalId: 'x' },
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    },
  },
];

test('behavioural scenarios through the direct driver', async () => {
  const definition = defineApplication({
    manifest: defineManifest({
      id: 'field',
      title: 'Field',
      modules: [],
      plugins: [hubLinkPluginManifest],
    }),
    createState: () => ({}),
    handlers: [],
    authorization: { authorize: () => ({ allowed: false }), canReadEvent: () => false },
    plugins: [hubLinkPlugin],
  });
  const application = createApplicationRuntime(definition, {
    storage: createMemoryStorage(definition.createState(LOCAL_USER)),
  });
  await runScenarios(scenarios, directDriver(application));
});
