import { expect, test } from 'bun:test';
import { LOCAL_USER, LOCAL_WORKSPACE } from '@tortoise/kernel/instance';
import { createApplicationRuntime } from '@tortoise/host/application';
import { createMemoryStorage } from '@tortoise/runtime';
import { directDriver, runScenarios, type BehavioralScenario } from '@tortoise/testing/scenarios';
import { peerLinkOperations as ops } from '../src/contracts';
import type { PeerLinkService } from '../src/service';
import { requestInspection, hold, qualityApplication, api, whoami } from './fixtures';

const localUser = { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_USER };
const guest = { ...localUser, principalId: 'ann' };
const tokenDigest = 'a'.repeat(64);
const publicKey = 'A'.repeat(43);
let key = 0;
const command = (operation: string, input: unknown) => ({
  operation,
  input,
  idempotencyKey: `scenario-${++key}`,
});
const resolve = async (
  driver: Parameters<BehavioralScenario['run']>[0],
  input: Record<string, unknown>,
) => (await driver.query({ operation: ops.credentialResolve.id, input }, localUser)).data;

const scenarios: BehavioralScenario[] = [
  {
    name: 'an admin enrolls, maps, resolves and revokes a peer; others are denied',
    async run(driver) {
      const created = await driver.command(
        command(ops.enrollmentCreate.id, {
          label: 'Receiving',
          operations: [requestInspection.id],
        }),
        localUser,
      );
      const { code } = created.result as { code: string };
      await expect(
        driver.command(command(ops.enrollmentCreate.id, { label: 'X' }), guest),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      const redeemed = await driver.command(
        command(ops.enrollmentRedeem.id, {
          code: code.toLowerCase(),
          tokenDigest,
          application: 'receiving',
          publicKey,
        }),
        localUser,
      );
      const { peer } = redeemed.result as { peer: { id: string; audience: string } };
      expect(peer).toMatchObject({
        application: 'receiving',
        audience: `quality#${peer.id}`,
        subjects: 'mapped',
        operations: [requestInspection.id],
        enrolledBy: LOCAL_USER,
      });
      await expect(
        driver.command(
          command(ops.enrollmentRedeem.id, {
            code,
            tokenDigest: 'b'.repeat(64),
            application: 'receiving',
            publicKey,
          }),
          localUser,
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      expect(await resolve(driver, { tokenDigest, subject: 'rita' })).toMatchObject({
        peer: { id: peer.id, publicKey },
        mapping: null,
      });
      await driver.command(
        command(ops.subjectMap.id, {
          peerId: peer.id,
          subject: 'rita',
          principalId: 'ann',
          operations: [whoami.id],
        }),
        localUser,
      );
      expect(await resolve(driver, { tokenDigest, subject: 'rita' })).toMatchObject({
        mapping: { principalId: 'ann', operations: [whoami.id] },
      });
      const mappings = await driver.query(
        { operation: ops.subjectList.id, input: { peerId: peer.id } },
        localUser,
      );
      expect((mappings.data as { mappings: unknown[] }).mappings).toHaveLength(1);
      await driver.command(
        command(ops.subjectUnmap.id, { peerId: peer.id, subject: 'rita' }),
        localUser,
      );
      expect(await resolve(driver, { tokenDigest, subject: 'rita' })).toMatchObject({
        mapping: null,
      });

      await driver.command(command(ops.revoke.id, { peerId: peer.id }), localUser);
      await driver.command(command(ops.revoke.id, { peerId: peer.id }), localUser);
      expect(await resolve(driver, { tokenDigest })).toEqual({ peer: null, mapping: null });
      await expect(
        driver.command(
          command(ops.subjectMap.id, { peerId: peer.id, subject: 'rita', principalId: 'ann' }),
          localUser,
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(
        driver.query({ operation: ops.list.id, input: {} }, guest),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    },
  },
  {
    name: 'enrollments name service operations and mappings name on-behalf-of operations',
    async run(driver) {
      await expect(
        driver.command(
          command(ops.enrollmentCreate.id, { label: 'R', operations: [hold.id] }),
          localUser,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      const created = await driver.command(
        command(ops.enrollmentCreate.id, { label: 'R' }),
        localUser,
      );
      const { code } = created.result as { code: string };
      const { peer } = (
        await driver.command(
          command(ops.enrollmentRedeem.id, {
            code,
            tokenDigest: 'c'.repeat(64),
            application: 'receiving',
            publicKey,
          }),
          localUser,
        )
      ).result as { peer: { id: string } };
      await expect(
        driver.command(
          command(ops.subjectMap.id, {
            peerId: peer.id,
            subject: 'rita',
            principalId: 'ann',
            operations: [requestInspection.id],
          }),
          localUser,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    },
  },
];

test('behavioural scenarios through the direct driver', async () => {
  const definition = qualityApplication();
  const service: PeerLinkService = {
    now: () => 1_000,
    application: 'quality',
    serviceOperations: new Set(api.serviceOperations),
    onBehalfOfOperations: new Set(api.onBehalfOfOperations),
    reserved: (principalId) => principalId.includes(':'),
    targets: new Map(),
    link: () => {
      throw new Error('No peer targets in scenarios');
    },
    connect: async () => {
      throw new Error('No peer targets in scenarios');
    },
  };
  const application = createApplicationRuntime(definition, {
    storage: createMemoryStorage(definition.createState(LOCAL_USER)),
    services: { 'peer-link': service },
  });
  await runScenarios(scenarios, directDriver(application));
});
