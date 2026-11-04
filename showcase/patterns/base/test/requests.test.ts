import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errorEnvelope } from '@tortoise/contracts';
import { openEmbeddedInstance } from '@tortoise/host';
import { directDriver, runScenarios, type BehavioralScenario } from '@tortoise/testing';
import { createTestRequestsApplication } from '../application';

const localUser = { workspaceId: 'local', principalId: 'local-user' };
const viewer = { workspaceId: 'local', principalId: 'viewer' };
const stranger = { workspaceId: 'local', principalId: 'stranger' };

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function open() {
  const directory = await mkdtemp(join(tmpdir(), 'pattern-base-'));
  let id = 0;
  const instance = await openEmbeddedInstance(
    createTestRequestsApplication({
      members: { viewer: 'viewer' },
      services: { newId: () => `r${++id}`, now: () => 1_000 },
    }),
    { workspacePath: join(directory, 'workspace') },
  );
  cleanup.push(async () => {
    await instance.close();
    await rm(directory, { recursive: true, force: true });
  });
  return instance;
}

const refused = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => errorEnvelope(error).code,
  );

const scenarios: BehavioralScenario[] = [
  {
    name: 'a technician submits a request and assigns its method at the revision they read',
    async run(driver) {
      const submitted = await driver.command(
        {
          operation: 'test-request.submit',
          input: {
            sample: 'OS-24-0417',
            transformer: 'TR-40517',
            description: 'Gas alarm after a load increase',
          },
        },
        localUser,
      );
      expect(submitted.result).toMatchObject({ id: 'r1', requester: 'local-user', method: '' });
      expect(submitted.revisions).toEqual({ 'test-request:r1': 1 });
      await driver.command(
        {
          operation: 'test-request.update',
          input: { id: 'r1', method: 'IEC 60567 dissolved gas analysis' },
          expectedRevisions: { 'test-request:r1': 1 },
        },
        localUser,
      );
      const read = await driver.query(
        { operation: 'test-request.get', input: { id: 'r1' } },
        viewer,
      );
      expect(read.data).toMatchObject({
        sample: 'OS-24-0417',
        method: 'IEC 60567 dissolved gas analysis',
      });
    },
  },
  {
    name: 'a change at a stale revision conflicts',
    async run(driver) {
      expect(
        await refused(
          driver.command(
            {
              operation: 'test-request.update',
              input: { id: 'r1', method: 'IEC 60156 breakdown voltage' },
              expectedRevisions: { 'test-request:r1': 1 },
            },
            localUser,
          ),
        ),
      ).toBe('CONFLICT');
    },
  },
  {
    name: 'a repeated idempotency key returns the stored command result and submits nothing',
    async run(driver) {
      const request = {
        operation: 'test-request.submit',
        input: { sample: 'OS-24-0502', transformer: 'TR-40517', description: 'Water content' },
        idempotencyKey: 'submit-once',
      };
      const first = await driver.command(request, localUser);
      const second = await driver.command(request, localUser);
      expect(second.result).toEqual(first.result);
      const list = await driver.query(
        { operation: 'test-request.list', input: { search: 'water' } },
        localUser,
      );
      expect(list.data).toMatchObject({ total: 1 });
    },
  },
  {
    name: 'a viewer reads but cannot submit, and a non-member cannot read',
    async run(driver) {
      expect(
        await refused(
          driver.command(
            {
              operation: 'test-request.submit',
              input: { sample: 'OS-9', transformer: 'TR-40517', description: '' },
            },
            viewer,
          ),
        ),
      ).toBe('FORBIDDEN');
      expect(
        await refused(driver.query({ operation: 'test-request.list', input: {} }, stranger)),
      ).toBe('FORBIDDEN');
    },
  },
];

test('the lab request scenarios hold on the embedded instance', async () => {
  const instance = await open();
  await runScenarios(scenarios, directDriver(instance.application));
});
