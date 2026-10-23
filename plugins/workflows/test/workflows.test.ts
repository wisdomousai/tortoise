import { describe, expect, test } from 'bun:test';
import { flaky, inProcess, person } from './fixture';

const HOUR = 3_600_000;

/** A parcel created and filed by ann, which starts `ship-parcel` through `parcel.file`. */
async function filed(app: ReturnType<typeof inProcess>, id = 'p1') {
  await app.invoke('parcel.create', { id });
  const receipt = await app.invoke('parcel.file', { id });
  return (receipt.result as { id: string }).id;
}
const carrierEffect = async (app: ReturnType<typeof inProcess>) =>
  (await app.pending()).find((effect) => effect.target === 'carrier')!;
const settleCarrier = async (app: ReturnType<typeof inProcess>, id: string, accepted = true) =>
  app.invoke(
    'carrier.settle',
    { id, effect: (await carrierEffect(app)).id, accepted },
    person('owner'),
  );

describe('workflow instances', () => {
  test('a filed parcel is reserved, shipped, delivered and confirmed, one step per advance', async () => {
    const app = inProcess();
    const id = await filed(app);
    expect(await app.instance(id)).toMatchObject({
      status: 'running',
      step: 'reserve',
      starter: 'ann',
    });

    await app.pass();
    expect(await app.parcel('p1')).toMatchObject({ status: 'reserved', calls: 1 });
    await app.pass();
    expect(await app.parcel('p1')).toMatchObject({ status: 'shipped' });
    // The carrier has not answered: an idle pass writes nothing.
    const awaiting = await app.instance(id);
    await app.pass();
    expect(await app.instance(id)).toEqual(awaiting);

    await settleCarrier(app, 'p1');
    await app.pass();
    await app.pass();
    expect(await app.instance(id)).toMatchObject({ status: 'waiting', step: 'delivered' });
    // Nothing of a watched type changed: the runner leaves it alone.
    const waiting = await app.instance(id);
    await app.pass();
    expect(await app.instance(id)).toEqual(waiting);

    await app.invoke('parcel.deliver', { id: 'p1' }, person('vic'));
    await app.pass();
    expect(await app.instance(id)).toMatchObject({ status: 'running', step: 'confirm' });
    await app.pass();
    const done = await app.instance(id);
    expect(done).toMatchObject({ status: 'succeeded', input: { id: 'p1' } });
    expect(
      done.history.map(
        (entry: { step: string; outcome: string }) => `${entry.step}:${entry.outcome}`,
      ),
    ).toEqual(['reserve:completed', 'ship:completed', 'delivered:completed', 'confirm:completed']);
    // Only the paths later steps read are kept.
    expect(done.values).toEqual({
      reserve: { id: 'p1' },
      ship: { '#0.externalRef': 'track-p1' },
      delivered: {},
      confirm: {},
    });
    expect(await app.parcel('p1')).toMatchObject({
      status: 'confirmed',
      confirmations: 1,
      ref: 'track-p1',
    });
    expect(app.errors).toEqual([]);
  });

  test('a refused shipment undoes the reservation and ends compensated', async () => {
    const app = inProcess();
    const id = await filed(app);
    await app.pass();
    await app.pass();
    await settleCarrier(app, 'p1', false);
    await app.pass();
    expect(await app.instance(id)).toMatchObject({
      status: 'compensating',
      step: 'reserve',
      error: { step: 'ship', code: 'REFUSED' },
    });
    await app.pass();
    expect(await app.instance(id)).toMatchObject({ status: 'compensated' });
    expect(await app.parcel('p1')).toMatchObject({ status: 'released' });
  });

  test('a wait that outlasts its timeout fails the step and compensates', async () => {
    const app = inProcess();
    const id = await filed(app);
    for (let index = 0; index < 2; index++) await app.pass();
    await settleCarrier(app, 'p1');
    for (let index = 0; index < 3; index++) await app.pass();
    expect(await app.instance(id)).toMatchObject({ status: 'waiting' });
    app.advance(HOUR);
    await app.pass();
    expect(await app.instance(id)).toMatchObject({
      status: 'compensating',
      error: { step: 'delivered', code: 'TIMEOUT' },
    });
    await app.pass();
    expect((await app.instance(id)).status).toBe('compensated');
  });

  test('a transient failure is retried after a backoff; a permanent one compensates', async () => {
    const app = inProcess();
    await app.invoke('parcel.create', { id: 'p1' });
    const started = await app.invoke('workflow.start', {
      workflow: 'flaky-parcel',
      input: { id: 'p1' },
    });
    const id = (started.result as { id: string }).id;
    flaky.failures = 1;
    flaky.code = 'UNAVAILABLE';
    await app.pass();
    await app.pass();
    expect(await app.instance(id)).toMatchObject({ status: 'running', step: 'flaky' });
    expect((await app.instance(id)).history.at(-1)).toMatchObject({
      outcome: 'retried',
      code: 'UNAVAILABLE',
    });
    // Not due before its backoff.
    const backingOff = await app.instance(id);
    await app.pass();
    expect(await app.instance(id)).toEqual(backingOff);
    app.advance(1_000);
    await app.pass();
    expect((await app.instance(id)).status).toBe('succeeded');

    await app.invoke('parcel.create', { id: 'p2' });
    const second = (
      (await app.invoke('workflow.start', { workflow: 'flaky-parcel', input: { id: 'p2' } }))
        .result as { id: string }
    ).id;
    flaky.failures = 1;
    flaky.code = 'INVALID_INPUT';
    await app.pass();
    await app.pass();
    expect(await app.instance(second)).toMatchObject({
      status: 'compensating',
      error: { step: 'flaky', code: 'INVALID_INPUT' },
    });
    await app.pass();
    expect((await app.instance(second)).status).toBe('compensated');
    expect(await app.parcel('p2')).toMatchObject({ status: 'released' });
  });
});

/** The runner's context for one due instance, built the way the runner builds it. */
async function asRunner(app: ReturnType<typeof inProcess>, id: string) {
  const { items } = await app.query('workflow.due', {}, person('owner'));
  const item = items.find((candidate: { id: string }) => candidate.id === id);
  const runId = `wf:${id}`;
  return {
    item,
    context: {
      principalId: item.starter,
      workspaceId: 'local',
      runId,
      grant: { ...item.grant, principalId: item.starter, workspaceId: 'local', runId },
    },
  };
}

describe('workflow durability', () => {
  test('each step is audited as the starter within the instance run, nested under the advance', async () => {
    const app = inProcess();
    const id = await filed(app);
    await app.pass();
    const accepted = app.log
      .events()
      .filter((record) => record.kind === 'command.accepted' && record.actor?.runId === `wf:${id}`);
    expect(accepted.map((record) => [record.operation, (record.data as any)?.depth])).toEqual([
      ['workflow.advance', undefined],
      ['parcel.reserve', 1],
    ]);
    expect(accepted[1]?.actor).toMatchObject({ principalId: 'ann' });
    expect(accepted[1]?.correlationId).toBe(accepted[0]?.correlationId);
  });

  test('an advance repeated after a crash replays its receipt; a stale seq changes nothing', async () => {
    const app = inProcess();
    const id = await filed(app);
    const { item, context } = await asRunner(app, id);
    const advance = (seq: number, key: string) =>
      app.application.invokeRaw(
        { operation: 'workflow.advance', input: { id, seq }, idempotencyKey: key },
        context,
      );
    const first = await advance(item.seq, `wf:${id}:0`);
    const replayed = await advance(item.seq, `wf:${id}:0`);
    expect(replayed.result).toEqual(first.result);
    expect(replayed.revisions).toEqual(first.revisions);
    const stale = await advance(item.seq, 'another-key');
    expect(stale.result).toEqual({ id, seq: 1, status: 'running' });
    expect(await app.parcel('p1')).toMatchObject({ status: 'reserved', calls: 1 });
    expect((await app.instance(id)).step).toBe('ship');
  });

  test('a held effect keeps the step waiting and shows as held until it is settled', async () => {
    const app = inProcess();
    const id = await filed(app);
    await app.pass();
    await app.pass();
    await app.application.recordAttempt(
      person('owner'),
      (await carrierEffect(app)).id,
      'Outcome unknown',
      {
        hold: true,
      },
    );
    await app.pass();
    expect(await app.instance(id)).toMatchObject({ status: 'running', step: 'ship', held: true });
    const held = await app.instance(id);
    await app.pass();
    expect(await app.instance(id)).toEqual(held);
    await settleCarrier(app, 'p1');
    await app.pass();
    const moved = await app.instance(id);
    expect(moved).toMatchObject({ step: 'delivered' });
    expect(moved.held).toBeUndefined();
  });

  test('a changed definition stalls the instance; it cannot be retried, and cancelling undoes it', async () => {
    const app = inProcess();
    const id = await filed(app);
    await app.pass();
    const definition = app.definitions.get('ship-parcel')!;
    app.definitions.set('ship-parcel', { ...definition, fingerprint: 'changed' });
    await app.pass();
    expect(await app.instance(id)).toMatchObject({
      status: 'stalled',
      stalledReason: 'DEFINITION_CHANGED',
    });
    await expect(app.invoke('workflow.retry', { id })).rejects.toMatchObject({ code: 'CONFLICT' });
    await app.invoke('workflow.cancel', { id });
    expect((await app.instance(id)).status).toBe('compensating');
    await app.pass();
    expect(await app.instance(id)).toMatchObject({ status: 'cancelled', cancelledBy: 'ann' });
    expect(await app.parcel('p1')).toMatchObject({ status: 'released' });
  });

  test('a role the starter lost refuses the step, and the reservation is undone', async () => {
    const app = inProcess();
    const id = await filed(app);
    await app.pass();
    await app.invoke('role.set', { principalId: 'ann', role: 'viewer' }, person('owner'));
    await app.pass();
    expect(await app.instance(id)).toMatchObject({
      status: 'compensating',
      error: { step: 'ship', code: 'FORBIDDEN' },
    });
    await app.pass();
    expect((await app.instance(id)).status).toBe('compensated');
    expect(await app.parcel('p1')).toMatchObject({ status: 'released' });
  });

  test('cancelling during a wait undoes the completed steps', async () => {
    const app = inProcess();
    const id = await filed(app);
    for (let index = 0; index < 2; index++) await app.pass();
    await settleCarrier(app, 'p1');
    for (let index = 0; index < 3; index++) await app.pass();
    expect((await app.instance(id)).status).toBe('waiting');
    const cancelled = await app.invoke('workflow.cancel', { id }, person('owner'));
    expect(cancelled.result).toMatchObject({ status: 'compensating' });
    expect(cancelled.result).not.toHaveProperty('input');
    await app.pass();
    expect(await app.instance(id)).toMatchObject({ status: 'cancelled', cancelledBy: 'owner' });
  });
});

describe('workflow access', () => {
  test('the starter sees values, the owner status only, anyone else nothing', async () => {
    const app = inProcess();
    const id = await filed(app);
    await app.pass();
    expect(await app.instance(id)).toMatchObject({
      input: { id: 'p1' },
      values: { reserve: { id: 'p1' } },
    });
    const owner = await app.instance(id, person('owner'));
    expect(owner).toMatchObject({ id, status: 'running', starter: 'ann' });
    for (const field of ['input', 'values', 'history', 'grantExpiresAt'])
      expect(owner).not.toHaveProperty(field);
    await expect(app.instance(id, person('vic'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await app.query('workflow.list', {}, person('vic'))).items).toEqual([]);
    expect((await app.query('workflow.list', {}, person('owner'))).items).toHaveLength(1);
    await expect(app.invoke('workflow.cancel', { id }, person('vic'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  test('only the runner advances, records failures and reads what is due', async () => {
    const app = inProcess();
    const id = await filed(app);
    const { context } = await asRunner(app, id);
    const tries = [
      { operation: 'workflow.advance', as: person('ann') },
      { operation: 'workflow.advance', as: { ...context, principalId: 'vic' } },
      { operation: 'workflow.fail', as: { ...context, runId: 'wf:other' } },
    ];
    for (const { operation, as } of tries)
      await expect(
        app.invoke(
          operation,
          { id, seq: 0, ...(operation === 'workflow.fail' ? { code: 'X', message: 'x' } : {}) },
          as,
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(app.query('workflow.due', {}, person('ann'))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    // Retry and resolve are for the starter as a person, not for a run acting as them.
    const agent = { ...person('ann'), runId: 'agent-1' };
    for (const operation of ['workflow.retry', 'workflow.resolve'])
      await expect(app.invoke(operation, { id }, agent)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
  });

  test('a workflow run cannot start another workflow', async () => {
    const app = inProcess();
    const id = await filed(app);
    await app.invoke('parcel.create', { id: 'p2' });
    await expect(
      app.invoke(
        'workflow.start',
        { workflow: 'ship-parcel', input: { id: 'p2' } },
        {
          ...person('ann'),
          runId: `wf:${id}`,
        },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      app.invoke('parcel.file', { id: 'p2' }, { ...person('ann'), runId: `wf:${id}` }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test("an instance's grant ends with the starter's, and a person renews it by retrying", async () => {
    const app = inProcess();
    await app.invoke('parcel.create', { id: 'p1' });
    const operations = [
      'workflow.start',
      'parcel.reserve',
      'parcel.release',
      'parcel.ship',
      'parcel.get',
      'parcel.confirm',
    ];
    const agent = (expiresAt: number, granted = operations) => ({
      ...person('ann'),
      runId: 'agent-1',
      grant: { operations: granted, expiresAt },
    });
    await expect(
      app.invoke(
        'workflow.start',
        { workflow: 'ship-parcel', input: { id: 'p1' } },
        agent(1_000_000 + HOUR, ['workflow.start', 'parcel.reserve']),
      ),
    ).rejects.toThrow(
      'Your grant does not cover parcel.release, parcel.ship, parcel.get, parcel.confirm',
    );
    const started = await app.invoke(
      'workflow.start',
      { workflow: 'ship-parcel', input: { id: 'p1' } },
      agent(1_000_000 + HOUR),
    );
    const id = (started.result as { id: string }).id;
    expect((await app.instance(id)).grantExpiresAt).toBe(1_000_000 + HOUR);
    const { item } = await asRunner(app, id);
    expect(item.grant.operations).toEqual([
      ...operations.slice(1),
      'workflow.advance',
      'workflow.fail',
    ]);

    app.advance(HOUR);
    expect(await app.instance(id)).toMatchObject({
      status: 'stalled',
      stalledReason: 'GRANT_EXPIRED',
    });
    expect((await app.query('workflow.due', {}, person('owner'))).items).toEqual([]);
    await app.invoke('workflow.retry', { id });
    const renewed = await app.instance(id);
    expect(renewed).toMatchObject({ status: 'running' });
    expect(renewed.grantExpiresAt).toBe(renewed.deadline + 86_400_000);
    await app.pass();
    expect(await app.parcel('p1')).toMatchObject({ status: 'reserved' });

    // A person's instance runs until a day past its deadline.
    await app.invoke('parcel.create', { id: 'p2' });
    const own = await app.invoke('workflow.start', {
      workflow: 'ship-parcel',
      input: { id: 'p2' },
    });
    const view = own.result as { deadline: number; grantExpiresAt: number };
    expect(view.grantExpiresAt).toBe(view.deadline + 86_400_000);
  });

  test('a business key admits one running instance at a time', async () => {
    const app = inProcess();
    const id = await filed(app);
    await expect(app.invoke('parcel.file', { id: 'p1' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await app.invoke('workflow.cancel', { id });
    await app.pass();
    expect((await app.instance(id)).status).toBe('cancelled');
    await app.invoke('parcel.create', { id: 'p1-again' });
    const again = await app.invoke('parcel.file', { id: 'p1' });
    expect((again.result as { id: string }).id).not.toBe(id);
  });
});
