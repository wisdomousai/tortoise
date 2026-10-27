import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  defineCapability,
  defineModule,
  jsonSchema,
  operationSchemaDigest,
  type AuditRecord,
} from '@agent-native/contracts';
import { createMemoryEventLog } from '@agent-native/event-log';
import {
  createApplication,
  createHandlerFactory,
  createMemoryStorage,
  type ExecutionContext,
} from '../src/index';

const requestInspection = defineCapability({
  id: 'request.create',
  kind: 'command',
  input: jsonSchema(z.strictObject({ lot: z.string() })),
  output: jsonSchema(z.strictObject({ by: z.string(), count: z.number() })),
  permission: { action: 'create', resourceType: 'inspection-request' },
  ui: { exception: 'test fixture' },
});
type State = { requests: string[] };

function fixture(output: unknown = requestInspection.output) {
  const records: AuditRecord[] = [];
  const log = createMemoryEventLog();
  const capability = { ...requestInspection, output } as typeof requestInspection;
  const bind = createHandlerFactory<State, {}>();
  const application = createApplication({
    id: 'quality',
    contractVersion: '2.1.0',
    modules: [defineModule({ id: 'requests', capabilities: [capability] })],
    storage: createMemoryStorage<State>({ requests: [] }),
    services: {},
    authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
    eventLog: {
      mode: log.mode,
      append: async (batch: readonly AuditRecord[]) => {
        records.push(...batch);
        return log.append(batch);
      },
    },
    handlers: [
      bind(capability, (input, ctx) => {
        ctx.state.requests.push(input.lot);
        ctx.change(`inspection-request:${input.lot}`);
        return { by: ctx.context.principalId, count: ctx.state.requests.length };
      }),
    ],
  });
  return { application, records };
}

/** A call from the peer `receiving`, for its person `rita`, mapped to `principalId` here. */
const onBehalf = (principalId: string): ExecutionContext => ({
  workspaceId: 'w',
  principalId,
  peer: { id: 'receiving', subject: 'rita' },
});

describe('peer calls', () => {
  test("a peer's key belongs to the peer: a changed mapping conflicts instead of running twice", async () => {
    const { application } = fixture();
    const request = {
      operation: requestInspection.id,
      input: { lot: 'L1' },
      idempotencyKey: 'effect-1',
    };
    expect((await application.invokeRaw(request, onBehalf('ann'))).result).toEqual({
      by: 'ann',
      count: 1,
    });
    // A retry for the same person replays the receipt.
    expect((await application.invokeRaw(request, onBehalf('ann'))).result).toEqual({
      by: 'ann',
      count: 1,
    });
    // After the peer's person was mapped to someone else, the same key is another request.
    await expect(application.invokeRaw(request, onBehalf('bob'))).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    // The person's own key is theirs, apart from the peer's.
    expect(
      (await application.invokeRaw(request, { workspaceId: 'w', principalId: 'ann' })).result,
    ).toEqual({ by: 'ann', count: 2 });
  });

  test('the audit actor names the peer and its person', async () => {
    const { application, records } = fixture();
    await application.invokeRaw(
      { operation: requestInspection.id, input: { lot: 'L1' }, idempotencyKey: 'k' },
      onBehalf('ann'),
    );
    expect(records.find((record) => record.kind === 'command.committed')?.actor).toMatchObject({
      principalId: 'ann',
      peer: 'receiving',
      subject: 'rita',
    });
  });

  test('the contract names the application and digests every operation schema', () => {
    const { application } = fixture();
    const contract = application.discover({ workspaceId: 'w', principalId: 'ann' });
    const operation = contract.operations.find(({ id }) => id === requestInspection.id)!;
    expect(operation.schemaDigest).toBe(operationSchemaDigest(operation));
    expect(contract.application).toMatchObject({ id: 'quality', contractVersion: '2.1.0' });
    // A changed output schema changes the operation's digest and the application's.
    const changed = fixture(jsonSchema(z.strictObject({ by: z.string() }))).application.discover({
      workspaceId: 'w',
      principalId: 'ann',
    });
    expect(changed.operations[0]!.schemaDigest).not.toBe(operation.schemaDigest);
    expect(changed.application!.digest).not.toBe(contract.application!.digest);
  });
});
