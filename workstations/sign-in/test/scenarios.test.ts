import { expect, test } from 'bun:test';
import { createApplicationRuntime } from '@tortoise/host/application';
import { LOCAL_OWNER, LOCAL_WORKSPACE } from '@tortoise/kernel/instance';
import { createMemoryStorage } from '@tortoise/runtime';
import { directDriver, runScenarios, type BehavioralScenario } from '@tortoise/testing/scenarios';
import { stationSignInOperations as ops } from '../src/contracts';
import { stationApplication } from './fixtures';

const owner = { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_OWNER };
const operator = { ...owner, principalId: 'ada@plant' };
let key = 0;
const command = (operation: string, input: unknown) => ({
  operation,
  input,
  idempotencyKey: `scenario-${++key}`,
});
const verifier = { pinSalt: '0'.repeat(32), pinHash: 'a'.repeat(64) };
const attempt = (badgeId: string, verified: boolean, tokenDigest = 'c'.repeat(64)) =>
  command(ops.sessionStart.id, {
    badgeId,
    verified,
    terminalPrincipal: LOCAL_OWNER,
    terminal: 'press-1',
    tokenDigest,
  });

const scenarios: BehavioralScenario[] = [
  {
    name: 'an admin enrolls and revokes badges; attempts lock a badge; operators manage nothing',
    async run(driver) {
      const enrolled = await driver.command(
        command(ops.badgeEnroll.id, {
          principalId: 'ada@plant',
          label: 'Ada',
          badgeDigest: 'b'.repeat(64),
          ...verifier,
        }),
        owner,
      );
      const { badge } = enrolled.result as { badge: { id: string } };
      await expect(
        driver.query({ operation: ops.badgeList.id, input: {} }, operator),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      for (let failure = 1; failure < 5; failure++)
        expect((await driver.command(attempt(badge.id, false), owner)).result).toEqual({
          session: null,
          refusal: 'pin',
        });
      expect((await driver.command(attempt(badge.id, false), owner)).result).toEqual({
        session: null,
        refusal: 'locked',
      });
      expect((await driver.command(attempt(badge.id, true), owner)).result).toEqual({
        session: null,
        refusal: 'locked',
      });
      await driver.command(command(ops.badgeRevoke.id, { badgeId: badge.id }), owner);
      const listed = await driver.query({ operation: ops.badgeList.id, input: {} }, owner);
      expect(
        (listed.data as { badges: { revokedAt?: number }[] }).badges[0]!.revokedAt,
      ).toBeDefined();
      expect(
        (
          await driver.query(
            { operation: ops.badgeVerifier.id, input: { badgeDigest: 'b'.repeat(64) } },
            owner,
          )
        ).data,
      ).toEqual({ badge: null });
    },
  },
];

test('station sign-in scenarios run through the direct driver', async () => {
  const definition = stationApplication();
  const application = createApplicationRuntime(definition, {
    storage: createMemoryStorage(definition.createState(LOCAL_OWNER)),
    services: { 'station-sign-in': { now: () => 1_000, sessionMinutes: 15 } },
  });
  await runScenarios(scenarios, directDriver(application));
});
