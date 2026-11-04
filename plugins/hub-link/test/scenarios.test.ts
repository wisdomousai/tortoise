import { expect, test } from 'bun:test';
import { LOCAL_OWNER, LOCAL_WORKSPACE } from '@tortoise/kernel/instance';
import { createApplicationRuntime, defineApplication } from '@tortoise/kernel/application';
import { defineManifest } from '@tortoise/kernel/manifest';
import { createMemoryStorage } from '@tortoise/runtime';
import { directDriver, runScenarios, type BehavioralScenario } from '@tortoise/testing/scenarios';
import { hubLinkOperations as ops } from '../src/contracts';
import { hubLinkPlugin } from '../src/plugin';
import { hubLinkPluginManifest } from '../src/plugin-manifest';

const owner = { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_OWNER };
const pairing = {
  origin: 'https://hub.plant.example',
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
        (await driver.query({ operation: ops.pairingGet.id, input: {} }, owner)).data;
      expect(await get()).toEqual({ pairing: null });
      await driver.command(
        { operation: ops.pairingRecord.id, input: { error: 'Code expired' }, idempotencyKey: 'e' },
        owner,
      );
      expect(await get()).toEqual({ pairing: null, lastError: 'Code expired' });
      await driver.command(
        { operation: ops.pairingRecord.id, input: { pairing }, idempotencyKey: 'p' },
        owner,
      );
      expect(await get()).toEqual({ pairing });
      await driver.command(
        { operation: ops.pairingClear.id, input: {}, idempotencyKey: 'c' },
        owner,
      );
      expect(await get()).toEqual({ pairing: null });
      await expect(
        driver.query({ operation: ops.pairingGet.id, input: {} }, { ...owner, principalId: 'x' }),
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
    storage: createMemoryStorage(definition.createState(LOCAL_OWNER)),
  });
  await runScenarios(scenarios, directDriver(application));
});
