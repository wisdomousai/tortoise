import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  defineCapability,
  defineModule,
  jsonSchema,
  type AuditMode,
  type AuditRecord,
  type EventLogPort,
} from '@agent-native/contracts';
import { createMemoryEventLog, unresolvedCommands } from '@agent-native/event-log';
import {
  createApplication,
  createHandlerFactory,
  createMemoryStorage,
  type EffectOutcome,
  type Storage,
} from '../src/index';

const record = defineCapability({
  id: 'reading.record',
  kind: 'command',
  input: jsonSchema(z.strictObject({ id: z.string(), value: z.number(), note: z.string() })),
  output: jsonSchema(z.strictObject({ effectId: z.string() })),
  permission: { action: 'create', resourceType: 'reading' },
  ui: { exception: 'test fixture' },
  integration: { target: 'sor', delivery: 'outbox' },
  audit: { fields: ['id'] },
});
const complete = defineCapability({
  id: 'reading.complete',
  kind: 'command',
  input: jsonSchema(
    z.strictObject({
      effectId: z.string(),
      outcome: z.strictObject({ status: z.literal('accepted') }),
    }),
  ),
  output: jsonSchema(z.strictObject({ status: z.string() })),
  permission: { action: 'complete', resourceType: 'reading' },
  ui: { exception: 'integration principal' },
});
const count = defineCapability({
  id: 'reading.count',
  kind: 'query',
  input: jsonSchema(z.strictObject({})),
  output: jsonSchema(z.number()),
  permission: { action: 'read', resourceType: 'reading' },
  ui: { exception: 'test fixture' },
});
const module = defineModule({
  id: 'readings',
  capabilities: [record, complete, count],
  requirements: {
    network: [
      {
        id: 'sor-api',
        purpose: 'Test system of record',
        direction: 'egress',
        scope: 'site',
        protocol: 'https',
        targets: ['sor'],
        dataClasses: ['reading'],
        availability: 'required',
        offline: 'queue',
      },
    ],
  },
});
type State = { readings: Record<string, number> };
const owner = { workspaceId: 'w', principalId: 'inspector', channel: 'http' as const };
const input = { id: 'r1', value: 10.5, note: 'operator remark' };
const mode = (queries: 'required' | 'best-effort' = 'required'): AuditMode => ({
  commands: 'required',
  queries,
  egress: 'required',
});

/** A memory log that refuses records of the given kinds, like a full disk at a bad moment. */
function failingLog(failKinds: string[], auditMode = mode()) {
  const inner = createMemoryEventLog({ mode: auditMode });
  const log: EventLogPort = {
    mode: auditMode,
    append: (records: readonly AuditRecord[]) =>
      records.some((item) => failKinds.includes(item.kind))
        ? Promise.reject(new Error('disk full'))
        : inner.append(records),
  };
  return { log, events: inner.events };
}

function fixture(
  eventLog: EventLogPort,
  options: { deny?: boolean; storage?: Storage<State> } = {},
) {
  const storage = options.storage ?? createMemoryStorage<State>({ readings: {} });
  const bind = createHandlerFactory<State, {}>();
  const app = createApplication({
    modules: [module],
    storage,
    services: {},
    eventLog,
    newEffectId: () => crypto.randomUUID(),
    authorization: {
      authorize: () =>
        options.deny ? { allowed: false, reason: 'Not a member' } : { allowed: true },
      canReadEvent: () => true,
    },
    handlers: [
      bind(record, (value, ctx) => {
        ctx.state.readings[value.id] = value.value;
        ctx.change(`reading:${value.id}`);
        return {
          effectId: ctx.enqueue({
            target: 'sor',
            type: 'reading.post',
            resource: `reading:${value.id}`,
            payload: value,
          }),
        };
      }),
      bind(complete, (value, ctx) => {
        const effect = ctx.completeEffect(value.effectId, value.outcome as EffectOutcome);
        ctx.change(effect.resource);
        return { status: effect.status };
      }),
      bind(count, (_, ctx) => Object.keys(ctx.state.readings).length),
    ],
  });
  return { app, storage };
}
const readings = (storage: Storage<State>) =>
  storage.read('w', async (snapshot) => Object.keys(snapshot.state.readings).length);

describe('audited runtime', () => {
  test('a command records accepted, committed and enqueued under one correlation', async () => {
    const log = createMemoryEventLog();
    const { app } = fixture(log);
    const receipt = await app.invoke(
      { operation: 'reading.record', input, idempotencyKey: 'k1' },
      owner,
    );
    const events = log.events();
    expect(events.map((event) => event.kind)).toEqual([
      'command.accepted',
      'command.committed',
      'effect.enqueued',
    ]);
    expect(new Set(events.map((event) => event.correlationId)).size).toBe(1);
    expect(events[0]!.actor).toEqual({ principalId: 'inspector', workspaceId: 'w', via: 'http' });
    expect(events[1]!.cursor).toBe(receipt.cursor);
    expect(events[0]!.inputDigest).toMatch(/^[0-9a-f]{64}$/);
    // Only allow-listed fields appear in plain text; the note and value stay out of the log.
    expect(events[0]!.data).toMatchObject({
      fields: ['id', 'note', 'value'],
      values: { id: 'r1' },
    });
    expect(JSON.stringify(events)).not.toContain('operator remark');
    expect(JSON.stringify(events)).not.toContain('10.5');
    expect(events[2]!.data).toMatchObject({ target: 'sor', effectId: receipt.effects![0] });
  });

  test('fail-closed: an unwritable log commits nothing and reports UNAVAILABLE', async () => {
    const { log } = failingLog(['command.accepted']);
    const { app, storage } = fixture(log);
    await expect(
      app.invoke({ operation: 'reading.record', input, idempotencyKey: 'k1' }, owner),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(await readings(storage)).toBe(0);
  });

  test('best-effort: the command commits and the gap is left for verification', async () => {
    const { log } = failingLog(['command.accepted'], { ...mode(), commands: 'best-effort' });
    const { app, storage } = fixture(log);
    await app.invoke({ operation: 'reading.record', input, idempotencyKey: 'k1' }, owner);
    expect(await readings(storage)).toBe(1);
  });

  test('denials are recorded with a safe reason and nothing is accepted', async () => {
    const log = createMemoryEventLog();
    const { app } = fixture(log, { deny: true });
    await expect(
      app.invoke({ operation: 'reading.record', input, idempotencyKey: 'k1' }, owner),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(app.query({ operation: 'reading.count', input: {} }, owner)).rejects.toThrow();
    expect(log.events().map((event) => [event.kind, event.reason])).toEqual([
      ['command.denied', 'FORBIDDEN'],
      ['query.denied', 'FORBIDDEN'],
    ]);
  });

  test('queries are recorded, and a required query log withholds data when unwritable', async () => {
    const log = createMemoryEventLog();
    await fixture(log).app.query({ operation: 'reading.count', input: {} }, owner);
    expect(log.events()[0]).toMatchObject({ kind: 'query.executed', operation: 'reading.count' });
    const { app } = fixture(failingLog(['query.executed']).log);
    await expect(app.query({ operation: 'reading.count', input: {} }, owner)).rejects.toMatchObject(
      { code: 'UNAVAILABLE' },
    );
    const relaxed = fixture(failingLog(['query.executed'], mode('best-effort')).log);
    expect((await relaxed.app.query({ operation: 'reading.count', input: {} }, owner)).data).toBe(
      0,
    );
  });

  test('replays, completions and delivery attempts are recorded', async () => {
    const log = createMemoryEventLog();
    const { app } = fixture(log);
    const request = { operation: 'reading.record' as const, input, idempotencyKey: 'k1' };
    const receipt = await app.invoke(request, owner);
    await app.invoke(request, owner);
    const integration = { workspaceId: 'w', principalId: 'integration' };
    await app.recordAttempt(integration, receipt.effects![0]!, 'timeout');
    await app.recordAttempt(integration, receipt.effects![0]!, 'lost reply', { hold: true });
    await app.invoke(
      {
        operation: 'reading.complete',
        input: { effectId: receipt.effects![0]!, outcome: { status: 'accepted' } },
        idempotencyKey: 's1',
      },
      integration,
    );
    const kinds = log.events().map((event) => event.kind);
    expect(kinds).toContain('command.replayed');
    expect(kinds).toContain('effect.attempted');
    expect(kinds).toContain('effect.held');
    expect(log.events().find((event) => event.kind === 'effect.completed')?.data).toMatchObject({
      status: 'accepted',
    });
  });

  test('startup recovery resolves accepted commands against the journal', async () => {
    // Committed, but the process stopped before `command.committed` was written.
    const crashed = failingLog(['command.committed']);
    const storage = createMemoryStorage<State>({ readings: {} });
    await fixture(crashed.log, { storage }).app.invoke(
      { operation: 'reading.record', input, idempotencyKey: 'k1' },
      owner,
    );
    // Accepted, then the storage commit itself failed and the failure record was lost too.
    const lost = failingLog(['command.failed']);
    const failingStorage: Storage<State> = {
      read: storage.read,
      transact: (id, fn) =>
        storage.read(id, async (snapshot) => {
          await fn(snapshot);
          throw new Error('commit failed');
        }),
    };
    await expect(
      fixture(lost.log, { storage: failingStorage }).app.invoke(
        { operation: 'reading.record', input: { ...input, id: 'r2' }, idempotencyKey: 'k2' },
        owner,
      ),
    ).rejects.toThrow('commit failed');

    const accepted = unresolvedCommands([...crashed.events(), ...lost.events()]);
    expect(accepted).toHaveLength(2);
    const recoveryLog = createMemoryEventLog();
    const records = await fixture(recoveryLog, { storage }).app.recoverAudit(accepted);
    expect(records.map((item) => [item.kind, item.reason])).toEqual([
      ['command.recovered', undefined],
      ['command.aborted', 'NOT_COMMITTED'],
    ]);
    expect(unresolvedCommands([...accepted, ...recoveryLog.events()])).toHaveLength(0);
  });
});
