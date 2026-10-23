import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errorEnvelope } from '@agent-native/contracts';
import { openEmbeddedInstance } from '@agent-native/host';
import { directDriver, runScenarios, type BehavioralScenario } from '@agent-native/testing';
import { createNotesApplication } from '../application';

const owner = { workspaceId: 'local', principalId: 'owner' };
const viewer = { workspaceId: 'local', principalId: 'viewer' };
const stranger = { workspaceId: 'local', principalId: 'stranger' };

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function open() {
  const directory = await mkdtemp(join(tmpdir(), 'sample-notes-'));
  let id = 0;
  const instance = await openEmbeddedInstance(
    createNotesApplication({
      members: { viewer: 'viewer' },
      services: { newId: () => `n${++id}`, now: () => 1_000 },
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
    name: 'an editor adds a note and changes it at the revision they read',
    async run(driver) {
      const added = await driver.command(
        { operation: 'note.add', input: { title: 'Shift log', text: 'Line 2 down' } },
        owner,
      );
      expect(added.result).toMatchObject({ id: 'n1', author: 'owner' });
      expect(added.revisions).toEqual({ 'note:n1': 1 });
      await driver.command(
        {
          operation: 'note.update',
          input: { id: 'n1', text: 'Line 2 running' },
          expectedRevisions: { 'note:n1': 1 },
        },
        owner,
      );
      const read = await driver.query({ operation: 'note.get', input: { id: 'n1' } }, viewer);
      expect(read.data).toMatchObject({ title: 'Shift log', text: 'Line 2 running' });
    },
  },
  {
    name: 'a change at a stale revision conflicts',
    async run(driver) {
      expect(
        await refused(
          driver.command(
            {
              operation: 'note.update',
              input: { id: 'n1', title: 'Late' },
              expectedRevisions: { 'note:n1': 1 },
            },
            owner,
          ),
        ),
      ).toBe('CONFLICT');
    },
  },
  {
    name: 'a repeated idempotency key returns the stored receipt and adds nothing',
    async run(driver) {
      const request = {
        operation: 'note.add',
        input: { title: 'Once', text: '' },
        idempotencyKey: 'add-once',
      };
      const first = await driver.command(request, owner);
      const second = await driver.command(request, owner);
      expect(second.result).toEqual(first.result);
      const list = await driver.query({ operation: 'note.list', input: { search: 'once' } }, owner);
      expect(list.data).toMatchObject({ total: 1 });
    },
  },
  {
    name: 'a viewer reads but cannot write, and a non-member cannot read',
    async run(driver) {
      expect(
        await refused(
          driver.command({ operation: 'note.add', input: { title: 'No', text: '' } }, viewer),
        ),
      ).toBe('FORBIDDEN');
      expect(await refused(driver.query({ operation: 'note.list', input: {} }, stranger))).toBe(
        'FORBIDDEN',
      );
    },
  },
];

test('the notes scenarios hold on the embedded instance', async () => {
  const instance = await open();
  await runScenarios(scenarios, directDriver(instance.application));
});
