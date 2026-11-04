import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHost } from '@tortoise/host/host';
import { unboundOperations } from '@tortoise/testing/ui-bindings';
import { automationModule } from '../contracts';
import { checkOnReceive, lotsApplication, person } from './fixture';

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

test('a local model is reached only through the network port; without a binding the run fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'automation-'));
  const options = { workspacePath: join(directory, 'workspace'), integration: false as const };
  try {
    // No harness meets the agent's local requirement: the plugin refuses to open.
    await expect(
      startHost(lotsApplication({ triggers: [checkOnReceive] }).definition, options),
    ).rejects.toThrow('requires a local model');
    // With a local model but no network plugin, the kernel's port reaches nothing.
    const host = await startHost(
      lotsApplication({ triggers: [checkOnReceive], localModel: { model: 'qwen-local' } })
        .definition,
      options,
    );
    try {
      await host.application.invokeRaw(
        {
          operation: 'automation.grant.issue',
          input: { trigger: 'check-on-receive', expiresInMs: 3_600_000 },
        },
        person('ann'),
      );
      await Bun.sleep(50);
      await host.application.invokeRaw(
        { operation: 'lot.receive', input: { id: 'l1' } },
        person('vic'),
      );
      const failures = async () =>
        (
          (await host.application.queryRaw(
            { operation: 'automation.failure.list', input: { open: true } },
            person('ann'),
          )) as { data: { items: { code: string; message: string }[] } }
        ).data.items;
      await until(async () => (await failures()).length === 1);
      expect((await failures())[0]).toMatchObject({ code: 'UNAVAILABLE' });
      expect((await failures())[0]!.message).toContain('unreachable or unbound');
    } finally {
      await host.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
