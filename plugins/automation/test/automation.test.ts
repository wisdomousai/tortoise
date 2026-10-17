import { describe, expect, test } from 'bun:test';
import { defineTrigger } from '../contracts';
import { resolveTriggers } from '../triggers';
import type { Harness, HarnessTurn } from '@agent-native/agents/types';
import { checkOnReceive, defaultJobs, inProcess, person } from './fixture';

const ann = person('ann');
const vic = person('vic');
const WEEK = 7 * 24 * 60 * 60 * 1000;
const issue = (env: ReturnType<typeof inProcess>, trigger = 'inspect-on-receive', as = ann) =>
  env.command('automation.grant.issue', { trigger, expiresInMs: WEEK }, as);
const summary = async (env: ReturnType<typeof inProcess>, id = 'inspect-on-receive') =>
  (await env.query('automation.trigger.list', {})).items.find((item: any) => item.id === id);

describe('automation triggers', () => {
  test('an event runs its job once as the issuer; a crash before recording replays instead of repeating', async () => {
    const env = inProcess();
    const grant = (await issue(env)).result as { id: string };
    let loop = env.loop();
    await env.pass(loop); // First sight: the grant starts at the current journal position.
    await env.command('lot.receive', { id: 'l1' }, vic);
    // The run commits, then the process dies before progress is recorded.
    let crash = true;
    loop = env.loop((run) => async (...args) => {
      const outcome = await run(...args);
      if (crash) {
        crash = false;
        throw new Error('crash');
      }
      return outcome;
    });
    await env.pass(loop);
    expect(env.errors).toHaveLength(1);
    expect(await env.inspections('l1')).toBe(1);
    // After the restart the same run ID reuses the same keys, so the commit replays.
    await env.pass(env.loop());
    await env.pass(env.loop());
    expect(await env.inspections('l1')).toBe(1);
    expect(await summary(env)).toMatchObject({ lastOutcome: 'succeeded', openFailures: 0 });
    // The audit log records the run's command as Ann within the run, and the recorded run.
    const records = env.log.events();
    const inspect = records.find(
      (record) => record.operation === 'lot.inspect' && record.kind === 'command.committed',
    );
    expect(inspect?.actor).toMatchObject({ principalId: 'ann', via: 'harness' });
    expect(inspect?.actor?.runId).toStartWith(`auto:${grant.id}:event:`);
    expect(
      records.some(
        (record) =>
          record.operation === 'automation.progress.record' &&
          (record.data as any)?.values?.run?.outcome === 'succeeded',
      ),
    ).toBe(true);
  });

  test('revoking stops future runs; a demoted issuer fails once into an open failure, never retried', async () => {
    const env = inProcess();
    const first = (await issue(env)).result as { id: string };
    await env.pass(env.loop());
    await env.command('lot.receive', { id: 'l1' }, vic);
    await env.pass(env.loop());
    expect(await env.inspections('l1')).toBe(1);
    await env.command('automation.grant.revoke', { id: first.id }, ann);
    await env.command('lot.receive', { id: 'l2' }, vic);
    await env.pass(env.loop());
    expect(await env.inspections('l2')).toBe(0);

    await issue(env);
    const loop = env.loop();
    await env.pass(loop);
    await env.command('role.set', { principalId: 'ann', role: 'viewer' }, vic);
    await env.command('lot.receive', { id: 'l3' }, vic);
    await env.pass(loop);
    await env.pass(loop);
    expect(await env.inspections('l3')).toBe(0);
    const failures = (await env.query('automation.failure.list', { open: true })).items;
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ trigger: 'inspect-on-receive' });
    expect(failures[0].message).toMatch(/denied|forbidden|not permitted/i);
    // Failures belong to the issuer; others see none and cannot resolve them.
    expect((await env.query('automation.failure.list', {}, vic)).items).toHaveLength(0);
    await expect(
      env.command('automation.failure.resolve', { id: failures[0].id }, vic),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await env.command('automation.failure.resolve', { id: failures[0].id }, ann);
    expect((await env.query('automation.failure.list', { open: true })).items).toHaveLength(0);
  });

  test('only people issue, renew and revoke grants, each their own; only the loop records progress', async () => {
    const env = inProcess();
    const delegated = {
      ...ann,
      runId: 'run-1',
      grant: { operations: ['automation.grant.issue'], principalId: 'ann', runId: 'run-1' },
    };
    await expect(issue(env, 'inspect-on-receive', delegated)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const grant = (await issue(env)).result as { id: string; operations: string[] };
    expect(grant.operations).toEqual(['lot.inspect', 'lot.get']);
    await expect(
      env.command('automation.grant.revoke', { id: grant.id }, vic),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      env.command('automation.grant.renew', { id: grant.id, expiresInMs: WEEK }, vic),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      env.command('automation.progress.record', { grant: grant.id, cursor: 99 }, ann),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      env.command('automation.grant.issue', { trigger: 'missing', expiresInMs: WEEK }, ann),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // Vic enabling the trigger replaces Ann's grant, so an event never starts two runs.
    await issue(env, 'inspect-on-receive', vic);
    expect((await summary(env)).grant).toMatchObject({ issuedBy: 'vic' });
  });

  test('a schedule runs once per slot, from the next slot, within its budget', async () => {
    const env = inProcess({
      jobs: {
        ...defaultJobs,
        reference: async ({ command }) => {
          await command('lot.inspect', { id: 'l0' });
          await command('lot.inspect', { id: 'l0' });
        },
      },
    });
    await issue(env, 'every-minute');
    const loop = env.loop();
    await env.pass(loop);
    await env.pass(loop);
    expect((await summary(env, 'every-minute')).lastRunAt).toBeUndefined();
    env.advance(60_000);
    await env.pass(loop);
    await env.pass(loop);
    // The job's second call exceeds the trigger's budget of one tool call: one commit, one failure.
    expect(await env.inspections('l0')).toBe(1);
    const failures = (await env.query('automation.failure.list', { open: true })).items;
    expect(failures).toHaveLength(1);
    expect(failures[0].code).toBe('BUDGET_EXCEEDED');
  });

  test('triggers are checked against the catalog and jobs when the plugin opens', () => {
    const { catalog } = inProcess().application;
    const jobs = new Map(Object.entries(defaultJobs));
    const base = { id: 't', title: 'T', on: { schedule: { everyMs: 60_000 } } } as const;
    for (const [trigger, message] of [
      [{ ...base, run: { job: 'missing', operations: [] } }, 'unregistered job'],
      [{ ...base, run: { job: 'inspect', operations: ['lot.unknown'] } }, 'unknown operations'],
      [
        { ...base, on: { schedule: { everyMs: 1_000 } }, run: { job: 'inspect', operations: [] } },
        'at least one minute',
      ],
      [
        {
          ...base,
          on: { event: { resourceType: 'lot', operations: ['lot.inspect'] } },
          run: { job: 'inspect', operations: ['lot.inspect'] },
        },
        'start itself again',
      ],
      [{ ...base, run: { agent: 'missing' } }, 'unknown agent'],
    ] as const)
      expect(() => resolveTriggers([defineTrigger(trigger as never)], catalog, jobs)).toThrow(
        message,
      );
  });

  test('an agent trigger runs on a harness that keeps its model local, as the issuer', async () => {
    const turns: HarnessTurn[] = [];
    const harness = (id: string, inference: Harness['inference']): Harness => ({
      id,
      features: { questions: false, approvals: false, resume: false },
      inference,
      availability: async () => ({ available: true }),
      async *run(turn) {
        turns.push(turn);
        const [resource] = (turn.context.uiContext as { selectedResources: string[] })
          .selectedResources;
        await turn.tools.execute(
          'lot.get',
          { input: { id: resource!.slice(4) } },
          { runId: turn.runId, signal: turn.signal, idempotencyKey: 'c1' },
        );
        yield { type: 'text', text: 'checked' };
      },
    });
    // The provider harness is listed first; the agent requires a local model, so it is skipped.
    const env = inProcess({
      triggers: [checkOnReceive],
      agentHarnesses: [harness('provider', 'remote'), harness('on-host', 'local')],
    });
    await issue(env, 'check-on-receive');
    const loop = env.loop();
    await env.pass(loop);
    await env.command('lot.receive', { id: 'l1' }, vic);
    await env.pass(loop);
    expect(await summary(env, 'check-on-receive')).toMatchObject({ lastOutcome: 'succeeded' });
    expect(turns).toHaveLength(1);
    expect(turns[0]!.tools.definitions?.map((tool) => tool.operation)).toEqual(['lot.get']);
    expect(turns[0]!.prompt).toContain('lot:l1');
  });

  test('an agent trigger with no harness that meets its model requirement fails into a failure', async () => {
    const remote: Harness = {
      id: 'provider',
      features: { questions: false, approvals: false, resume: false },
      availability: async () => ({ available: true }),
      async *run() {
        throw new Error('must not run');
      },
    };
    const env = inProcess({ triggers: [checkOnReceive], agentHarnesses: [remote] });
    await issue(env, 'check-on-receive');
    const loop = env.loop();
    await env.pass(loop);
    await env.command('lot.receive', { id: 'l1' }, vic);
    await env.pass(loop);
    const failures = (await env.query('automation.failure.list', { open: true })).items;
    expect(failures).toMatchObject([{ trigger: 'check-on-receive', code: 'UNAVAILABLE' }]);
  });
});
