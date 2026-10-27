import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errorEnvelope } from '@agent-native/contracts';
import { openEmbeddedInstance } from '@agent-native/host';
import { directDriver, runScenarios, type BehavioralScenario } from '@agent-native/testing';
import { createLabRequestsApplication } from '../application';

const owner = { workspaceId: 'local', principalId: 'owner' };
const viewer = { workspaceId: 'local', principalId: 'viewer' };
const stranger = { workspaceId: 'local', principalId: 'stranger' };

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function open() {
  const directory = await mkdtemp(join(tmpdir(), 'pattern-lab-requests-'));
  let id = 0;
  const instance = await openEmbeddedInstance(
    createLabRequestsApplication({
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
          input: { specimen: 'B-1042-03', description: 'Tensile strength of the weld coupon' },
        },
        owner,
      );
      expect(submitted.result).toMatchObject({ id: 'r1', requester: 'owner', method: '' });
      expect(submitted.revisions).toEqual({ 'test-request:r1': 1 });
      await driver.command(
        {
          operation: 'test-request.update',
          input: { id: 'r1', method: 'ASTM E8 tensile test' },
          expectedRevisions: { 'test-request:r1': 1 },
        },
        owner,
      );
      const read = await driver.query(
        { operation: 'test-request.get', input: { id: 'r1' } },
        viewer,
      );
      expect(read.data).toMatchObject({ specimen: 'B-1042-03', method: 'ASTM E8 tensile test' });
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
              input: { id: 'r1', method: 'ASTM E18 hardness test' },
              expectedRevisions: { 'test-request:r1': 1 },
            },
            owner,
          ),
        ),
      ).toBe('CONFLICT');
    },
  },
  {
    name: 'a repeated idempotency key returns the stored receipt and submits nothing',
    async run(driver) {
      const request = {
        operation: 'test-request.submit',
        input: { specimen: 'B-1043-01', description: 'Moisture content' },
        idempotencyKey: 'submit-once',
      };
      const first = await driver.command(request, owner);
      const second = await driver.command(request, owner);
      expect(second.result).toEqual(first.result);
      const list = await driver.query(
        { operation: 'test-request.list', input: { search: 'moisture' } },
        owner,
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
              input: { specimen: 'B-9', description: '' },
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
