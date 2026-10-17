import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHost } from '@agent-native/host/host';
import { unboundOperations } from '@agent-native/testing/ui-bindings';
import { automationModule } from '../contracts';
import { lotsApplication, person } from './fixture';

async function until(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (await check()) return;
    await Bun.sleep(10);
  }
  throw new Error('Condition not reached');
}

test('a serving host runs enabled triggers and resumes from recorded progress after a restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'automation-'));
  const options = { workspacePath: join(directory, 'workspace'), integration: false as const };
  const inspections = async (host: Awaited<ReturnType<typeof startHost>>, id: string) =>
    (
      (await host.application.queryRaw({ operation: 'lot.get', input: { id } }, person('ann'))) as {
        data: { inspections: number };
      }
    ).data.inspections;
  const started = async (host: Awaited<ReturnType<typeof startHost>>) =>
    (
      (await host.application.queryRaw(
        { operation: 'automation.trigger.list', input: {} },
        person('ann'),
      )) as { data: { items: { id: string; cursor?: number }[] } }
    ).data.items.find((item) => item.id === 'inspect-on-receive')?.cursor !== undefined;
  try {
    let host = await startHost(lotsApplication().definition, options);
    expect(host.plugins).toMatchObject({
      automation: { triggers: ['inspect-on-receive', 'every-minute'] },
    });
    await host.application.invokeRaw(
      {
        operation: 'automation.grant.issue',
        input: { trigger: 'inspect-on-receive', expiresInMs: 3_600_000 },
      },
      person('ann'),
    );
    await until(() => started(host));
    await host.application.invokeRaw(
      { operation: 'lot.receive', input: { id: 'l1' } },
      person('vic'),
    );
    await until(async () => (await inspections(host, 'l1')) === 1);
    await host.close();

    host = await startHost(lotsApplication().definition, options);
    await host.application.invokeRaw(
      { operation: 'lot.receive', input: { id: 'l2' } },
      person('vic'),
    );
    await until(async () => (await inspections(host, 'l2')) === 1);
    await Bun.sleep(50);
    expect(await inspections(host, 'l1')).toBe(1);
    await host.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('every automation operation that claims a UI binding is referenced by its screen', async () => {
  expect(await unboundOperations([automationModule], join(import.meta.dir, '../ui'))).toEqual([]);
});
