import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHost } from '@tortoise/host/host';
import { unboundOperations } from '@tortoise/testing/ui-bindings';
import { workflowsModule } from '../contracts';
import { parcelsApplication, person } from './fixture';

async function until(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (await check()) return;
    await Bun.sleep(10);
  }
  throw new Error('Condition not reached');
}

test('a serving host advances instances and resumes them after a restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-'));
  const options = { workspacePath: join(directory, 'workspace'), integration: false as const };
  type Host = Awaited<ReturnType<typeof startHost>>;
  const query = async (host: Host, operation: string, input: unknown): Promise<any> =>
    (await host.application.queryRaw({ operation, input }, person('ann'))).data;
  const invoke = (host: Host, operation: string, input: unknown, as = person('ann')) =>
    host.application.invokeRaw({ operation, input }, as);
  try {
    let host = await startHost(parcelsApplication(), options);
    expect(host.plugins).toMatchObject({
      workflow: { workflows: ['ship-parcel', 'flaky-parcel'] },
    });
    await invoke(host, 'parcel.create', { id: 'p1' });
    const filed = await invoke(host, 'parcel.file', { id: 'p1' });
    const id = (filed.result as { id: string }).id;
    // The runner reserves and ships, then waits for the carrier.
    await until(async () => (await query(host, 'parcel.get', { id: 'p1' })).status === 'shipped');
    await host.close();

    host = await startHost(parcelsApplication(), options);
    const [effect] = await host.application.pendingEffects(person('local-user'));
    await invoke(
      host,
      'carrier.complete',
      { id: 'p1', effect: effect!.id, accepted: true },
      person('local-user'),
    );
    await until(async () => (await query(host, 'workflow.get', { id })).status === 'waiting');
    await invoke(host, 'parcel.deliver', { id: 'p1' }, person('vic'));
    await until(async () => (await query(host, 'workflow.get', { id })).status === 'succeeded');
    expect(await query(host, 'parcel.get', { id: 'p1' })).toMatchObject({
      status: 'confirmed',
      calls: 1,
      ref: 'track-p1',
    });
    await host.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('every workflow operation that claims a UI binding is referenced by its screen', async () => {
  expect(await unboundOperations([workflowsModule], join(import.meta.dir, '../ui'))).toEqual([]);
});
