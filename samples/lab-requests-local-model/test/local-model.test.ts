import { afterEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { activates, defineModelEntry } from '@agent-native/agents/models';
import { approvalOperations, type ApprovalRequest } from '@agent-native/contracts';
import { exportApprovalDataset } from '@agent-native/runtime';
import { requestOperations } from '@agent-native/sample-lab-requests/contracts';
import { gateModel } from '@agent-native/testing/activation';
import type { AgentScenario } from '@agent-native/testing/agent-scenarios';
import { methodSuggester, METHOD_MODEL } from '../contracts';
import { standInEntry, standInModel } from '../model';
import { owner, refused, startLab, until, viewer } from './fixtures';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});
async function lab(options: Parameters<typeof startLab>[0] = {}) {
  const started = await startLab(options);
  cleanup.push(started.close);
  return started;
}

type Application = Awaited<ReturnType<typeof startLab>>['host']['application'];
let key = 0;
const command = (application: Application, operation: string, input: unknown, as = owner) =>
  application.invokeRaw({ operation, input, idempotencyKey: `k${++key}` }, as);
const pending = async (application: Application) =>
  (
    (
      await application.queryRaw(
        { operation: approvalOperations.approvalList.id, input: { status: 'pending' } },
        owner,
      )
    ).data as { items: ApprovalRequest[] }
  ).items;
const submit = async (application: Application, specimen: string, description: string) =>
  (
    await command(application, requestOperations.requestSubmit.id, {
      specimen,
      description,
      method: '',
    })
  ).result as { id: string };

/** Enable the trigger as the owner and wait until its loop has started the grant. */
async function enableTrigger(application: Application) {
  await command(application, 'automation.grant.issue', {
    trigger: 'suggest-methods-on-local-model',
    expiresInMs: 60 * 60 * 1000,
  });
  await until(async () => {
    const { data } = await application.queryRaw(
      { operation: 'automation.trigger.list', input: {} },
      owner,
    );
    return (data as { items: { cursor?: number }[] }).items[0]?.cursor !== undefined;
  });
}

/** Wait for the trigger's run on a new request to request approval, and return the request. */
async function suggestionFor(application: Application, id: string) {
  let found: ApprovalRequest | undefined;
  await until(async () => {
    found = (await pending(application)).find((item) => item.resource === `test-request:${id}`);
    return !!found;
  });
  return found!;
}

test('the trigger runs the method suggester on the measured local model, and a technician decides', async () => {
  const { host, models, audit } = await lab();
  const { application } = host;
  expect(models.status()).toEqual({
    state: 'ready',
    model: expect.objectContaining({
      entry: METHOD_MODEL,
      digest: standInEntry.base.digest,
      verified: true,
    }),
  });
  await enableTrigger(application);

  const coupon = await submit(application, 'PA6-0417', 'Notched impact strength, conditioned');
  const suggestion = await suggestionFor(application, coupon.id);
  expect(suggestion).toMatchObject({
    operation: requestOperations.requestUpdate.id,
    input: { id: coupon.id, method: 'ISO 179 Charpy impact' },
    requestedBy: 'owner',
  });
  // The run only requested approval; a viewer cannot approve, and the owner's approval updates.
  expect(
    await refused(
      command(application, approvalOperations.approvalApprove.id, { id: suggestion.id }, viewer),
    ),
  ).toBe('FORBIDDEN');
  await command(application, approvalOperations.approvalApprove.id, { id: suggestion.id });
  const updated = await application.queryRaw(
    { operation: requestOperations.requestGet.id, input: { id: coupon.id } },
    owner,
  );
  expect(updated.data).toMatchObject({ method: 'ISO 179 Charpy impact' });

  // The audit log names the measured weights the server started on and the model of each run.
  expect((await audit('model.started'))[0]?.data).toMatchObject({
    entry: METHOD_MODEL,
    base: standInEntry.base.digest,
  });
  expect((await audit('run.started')).map((record) => record.data?.model)).toContain(METHOD_MODEL);
});

test('weights that differ from the entry do not serve, and the agent gets no other model', async () => {
  const { models } = await lab({
    model: {
      ...standInModel(),
      entry: {
        ...standInEntry,
        base: { ...standInEntry.base, digest: `sha256:${'0'.repeat(64)}` },
      },
    },
  });
  expect(models.status()).toMatchObject({
    state: 'refused',
    reason: expect.stringContaining('measure'),
  });
  expect((await models.harness.availability()).available).toBe(false);
});

const sha = (bytes: string) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

test('decided suggestions export as a dataset, and a fine-tune on it serves only after its gate passes', async () => {
  // People decide three suggestions on the base model.
  const base = await lab();
  const { application } = base.host;
  await enableTrigger(application);
  const decide = async (specimen: string, description: string, approve: boolean) => {
    const { id } = await submit(application, specimen, description);
    const suggestion = await suggestionFor(application, id);
    await command(
      application,
      approve ? approvalOperations.approvalApprove.id : approvalOperations.approvalReject.id,
      approve ? { id: suggestion.id } : { id: suggestion.id, reason: 'Needs ISO 6892-1' },
    );
  };
  await decide('B-1042-03', 'Tensile strength of the weld coupon', true);
  await decide('BR-12', 'Rockwell hardness after heat treatment', true);
  await decide('B-1042-04', 'Tensile test at 200 °C', false);
  const dataset = await exportApprovalDataset(application, owner, {
    operations: [requestOperations.requestUpdate.id],
    redact: { rationale: true },
  });
  expect(
    dataset.rows.map((row) => [row.outcome, (row.input as { method: string }).method]),
  ).toEqual([
    ['approved', 'ASTM E8 tensile test'],
    ['approved', 'ASTM E18 Rockwell hardness'],
    ['rejected', 'ASTM E8 tensile test'],
  ]);
  expect(dataset.rows.every((row) => row.rationale === '[redacted]')).toBe(true);

  // Training happens outside the host; its adapter names the dataset by digest.
  const adapter = join(base.directory, 'lab-methods-lora.bin');
  const adapterBytes = `Stand-in LoRA adapter trained on ${dataset.digest}\n`;
  await writeFile(adapter, adapterBytes);
  const tuned = {
    entry: defineModelEntry({
      ...standInEntry,
      adapter: { kind: 'lora', digest: sha(adapterBytes), dataset: dataset.digest },
    }),
    files: { ...standInModel().files, adapter },
  };

  const unactivated = await lab({ model: tuned });
  expect(unactivated.models.status()).toMatchObject({
    state: 'refused',
    reason: expect.stringContaining('no passing activation'),
  });

  // The gate judges the fine-tune on an evaluation server, against the agent's scenarios.
  const evaluation = await lab({ model: tuned, evaluation: true });
  const scenario: AgentScenario = {
    name: 'suggests the tensile test for a tensile coupon',
    agent: methodSuggester.id,
    task: 'Suggest the test method for test-request:r1.',
    issuer: owner,
    resources: ['test-request:r1'],
    setup: [
      {
        operation: requestOperations.requestSubmit.id,
        input: {
          specimen: 'B-2001-01',
          description: 'Tensile strength of a rolled bar',
          method: '',
        },
        idempotencyKey: 'gate-setup',
      },
    ],
    expect: {
      commits: [],
      approvals: [
        {
          operation: requestOperations.requestUpdate.id,
          input: { method: 'ASTM E8 tensile test' },
        },
      ],
      outcome: 'succeeded',
    },
  };
  const { activation } = await gateModel({
    entry: tuned.entry,
    candidate: evaluation.models.evaluationHarness,
    scenarios: [scenario],
    application: () => evaluation.host.application,
  });
  expect(activation).toMatchObject({ passed: true, dataset: dataset.digest });
  expect(activates(activation, tuned.entry)).toBe(true);

  const served = await lab({ model: { ...tuned, activation } });
  expect(served.models.status()).toEqual({
    state: 'ready',
    model: expect.objectContaining({
      entry: METHOD_MODEL,
      adapterDigest: sha(adapterBytes),
      datasetDigest: dataset.digest,
      verified: true,
    }),
  });
});
