import { expect, test } from 'bun:test';
import { LOCAL_OWNER, LOCAL_WORKSPACE } from '@agent-native/kernel/instance';
import { createApplicationRuntime } from '@agent-native/host/application';
import { createMemoryStorage } from '@agent-native/runtime';
import {
  directDriver,
  runScenarios,
  type BehavioralScenario,
} from '@agent-native/testing/scenarios';
import { deviceLinkOperations as ops } from '../src/contracts';
import { hubApplication } from './fixtures';

const owner = { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_OWNER };
const guest = { ...owner, principalId: 'guest' };
const tokenDigest = 'a'.repeat(64);
let key = 0;
const command = (operation: string, input: unknown) => ({
  operation,
  input,
  idempotencyKey: `scenario-${++key}`,
});

const scenarios: BehavioralScenario[] = [
  {
    name: 'an admin enrolls, renames, resolves and revokes a phone; others are denied',
    async run(driver) {
      const created = await driver.command(
        command(ops.enrollmentCreate.id, { label: 'Phone', kind: 'field-sync' }),
        owner,
      );
      const { code } = created.result as { code: string };
      await expect(
        driver.command(command(ops.enrollmentCreate.id, { label: 'X', kind: 'field-sync' }), guest),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      // Codes are compared without case or separators, as people type them.
      const spaced = `${code.slice(0, 5)}-${code.slice(5)}`.toLowerCase();
      const redeemed = await driver.command(
        command(ops.enrollmentRedeem.id, { code: spaced, tokenDigest }),
        owner,
      );
      const { device } = redeemed.result as { device: { id: string; principalId: string } };
      expect(device).toMatchObject({ kind: 'field-sync', label: 'Phone', enrolledBy: LOCAL_OWNER });
      await expect(
        driver.command(
          command(ops.enrollmentRedeem.id, { code, tokenDigest: 'b'.repeat(64) }),
          owner,
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      await driver.command(
        command(ops.deviceRename.id, { deviceId: device.id, label: 'Phone 2' }),
        owner,
      );
      const listed = await driver.query({ operation: ops.deviceList.id, input: {} }, owner);
      expect((listed.data as { devices: { label: string }[] }).devices).toMatchObject([
        { label: 'Phone 2' },
      ]);
      expect(
        (await driver.query({ operation: ops.credentialResolve.id, input: { tokenDigest } }, owner))
          .data,
      ).toMatchObject({ device: { id: device.id } });

      await driver.command(command(ops.deviceRevoke.id, { deviceId: device.id }), owner);
      await driver.command(command(ops.deviceRevoke.id, { deviceId: device.id }), owner);
      expect(
        (await driver.query({ operation: ops.credentialResolve.id, input: { tokenDigest } }, owner))
          .data,
      ).toEqual({ device: null });
      await expect(
        driver.query({ operation: ops.deviceList.id, input: {} }, guest),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    },
  },
  {
    name: 'operations are chosen only for tablets, from the catalog, and never device management',
    async run(driver) {
      await expect(
        driver.command(
          command(ops.enrollmentCreate.id, {
            label: 'Phone',
            kind: 'field-sync',
            operations: ['captures.list'],
          }),
          owner,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(
        driver.command(
          command(ops.enrollmentCreate.id, {
            label: 'Tablet',
            kind: 'attached',
            operations: ['captures.delete'],
          }),
          owner,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(
        driver.command(
          command(ops.enrollmentCreate.id, {
            label: 'Tablet',
            kind: 'attached',
            operations: ['captures.list', ops.deviceRevoke.id],
          }),
          owner,
        ),
      ).rejects.toMatchObject({
        code: 'INVALID_INPUT',
        message: 'Devices cannot be granted device management: link.device.revoke',
      });
      const created = await driver.command(
        command(ops.enrollmentCreate.id, {
          label: 'Tablet',
          kind: 'attached',
          operations: ['captures.list'],
        }),
        owner,
      );
      expect(created.result).toMatchObject({ enrollmentId: expect.any(String) });
    },
  },
];

test('behavioural scenarios through the direct driver', async () => {
  const definition = hubApplication();
  const application = createApplicationRuntime(definition, {
    storage: createMemoryStorage(definition.createState(LOCAL_OWNER)),
    services: {
      'device-link': {
        now: () => 1_000,
        operations: new Set(
          definition.manifest.modules.flatMap((module) =>
            module.capabilities.map((capability) => capability.id),
          ),
        ),
      },
    },
  });
  await runScenarios(scenarios, directDriver(application));
});
