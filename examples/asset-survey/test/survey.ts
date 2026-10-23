import { afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BlobRef } from '@agent-native/contracts';
import { openEmbeddedInstance } from '@agent-native/host';
import type { PluginSettings } from '@agent-native/kernel/plugins/settings';
import type { ExecutionContext } from '@agent-native/runtime';
import { createAssetSurveyApplication } from '../application';
import { nameplatePhoto } from '../connectors/nameplate-photo';
import { FakeEam } from '../connectors/fake-eam';

export const at = (principalId: string): ExecutionContext => ({
  workspaceId: 'local',
  principalId,
});
export const owner = at('owner');
export const rita = at('rita');
export const vic = at('vic');
export const device = at('device:d1');
export const otherDevice = at('device:d2');

export type Node = {
  id: string;
  designation: string;
  label?: string;
  attributes: Record<string, { value: string; edited: boolean }>;
  assetId?: string;
  assetStatus?: string;
};
export type Field = { name: string; value: string; confidence: number; attention: boolean };

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

/**
 * A hub workspace with three members; `settings` are the plugins' (a site policy, say), and `now`
 * the workflows plugin's clock.
 */
export async function open(settings?: PluginSettings, options: { now?: () => number } = {}) {
  const workspacePath = await mkdtemp(join(tmpdir(), 'agent-native-survey-'));
  let eam!: FakeEam;
  const instance = await openEmbeddedInstance(
    createAssetSurveyApplication({
      members: { owner: 'manager', rita: 'reviewer', vic: 'viewer' },
      ...(options.now ? { workflows: { now: options.now } } : {}),
      onConnect: (ports) => {
        eam = ports.eam;
      },
    }),
    { workspacePath, ...(settings ? { settings } : {}) },
  );
  cleanup.push(() => rm(workspacePath, { recursive: true, force: true }));
  cleanup.push(() => instance.close());
  const { application, integrations } = instance;
  let key = 0;
  const query = async <T = Record<string, unknown>>(
    operation: string,
    input: unknown,
    as = owner,
  ) => (await application.queryRaw({ operation, input }, as)).data as T;
  const command = async <T = Record<string, unknown>>(
    operation: string,
    input: unknown,
    as = owner,
  ) =>
    (await application.invokeRaw({ operation, input, idempotencyKey: `k${++key}` }, as))
      .result as T;
  /** One outbox pass and one feed pass per target: what the background loops do. */
  const settle = async () => {
    await integrations.target('model').dispatcher.runOnce();
    await integrations.target('eam').dispatcher.runOnce();
    await integrations.sync();
  };
  const deliver = (target: string) => integrations.target(target).dispatcher.runOnce();
  const retry = async () => {
    await integrations.target('eam').dispatcher.runOnce(undefined, { ignoreBackoff: true });
    await integrations.sync();
  };
  const photo = (lines: Record<string, string>, as = device): Promise<BlobRef> =>
    application.putBlob(nameplatePhoto(lines), 'image/png', as);
  const node = (parentId: string | undefined, designation: string, name: string) =>
    command<Node>('structure.node.create', {
      ...(parentId ? { parentId } : {}),
      scheme: 'iec81346',
      designation,
      name,
    });
  return { application, query, command, settle, deliver, retry, photo, node, eam: () => eam };
}

/** A generator bay with two breakers, dispatched to device d1. */
export async function dispatched(survey: Awaited<ReturnType<typeof open>>) {
  const g1 = await survey.node(undefined, '=G1', 'Generator 1');
  const q1 = await survey.node(g1.id, '=G1-Q1', 'Generator circuit breaker');
  const q2 = await survey.node(g1.id, '=G1-Q2', 'Station supply breaker');
  const assignment = await survey.command<{ id: string; stage: string }>('assignment.create', {
    title: 'Nameplates of =G1',
    roots: [g1.id],
    kinds: ['nameplate'],
  });
  await survey.command('assignment.dispatch', { id: assignment.id, deviceId: 'd1' });
  return { g1, q1, q2, assignment };
}
