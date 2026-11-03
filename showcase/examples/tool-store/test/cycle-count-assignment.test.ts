import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEmbeddedInstance } from '@agent-native/host';
import { createToolStoreApplication } from '../application';

const owner = { workspaceId: 'local', principalId: 'owner' };
const clerk = { workspaceId: 'local', principalId: 'clerk' };
const viewer = { workspaceId: 'local', principalId: 'viewer' };
const stranger = { workspaceId: 'local', principalId: 'stranger' };
type Caller = typeof owner;
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

/**
 * A workspace with bin A-03 holding TC-00601 (available), TC-00602 (checked out), TC-00603
 * (missing) and TC-00604 (retired), and TC-00701 in bin B-01. The owner and `clerk` are
 * attendants, `viewer` is a viewer.
 */
async function open() {
  const workspacePath = await mkdtemp(join(tmpdir(), 'tool-store-cycle-count-'));
  cleanup.push(() => rm(workspacePath, { recursive: true, force: true }));
  let ids = 0;
  const instance = await openEmbeddedInstance(
    createToolStoreApplication({
      members: { clerk: 'attendant', viewer: 'viewer' },
      services: { newId: () => `id-${++ids}`, now: () => 1_000 },
    }),
    { workspacePath },
  );
  cleanup.push(() => instance.close());
  const app = instance.application;
  const run = async (operation: string, input: unknown, caller: Caller = owner) =>
    (await app.invokeRaw({ operation, input, idempotencyKey: crypto.randomUUID() }, caller))
      .result as { id: string };
  const read = async (operation: string, input: unknown, caller: Caller = owner) =>
    (await app.queryRaw({ operation, input }, caller)).data as Record<string, unknown>;
  const tool = async (assetTag: string, bin = 'A-03') =>
    (
      await run('tool.create', {
        assetTag,
        description: `Tool ${assetTag}`,
        category: 'hand-tool',
        bin,
      })
    ).id;
  const tools = {
    available: await tool('TC-00601'),
    lent: await tool('TC-00602'),
    missing: await tool('TC-00603'),
    retired: await tool('TC-00604'),
    elsewhere: await tool('TC-00701', 'B-01'),
  };
  await run('tool.check-out', {
    toolId: tools.lent,
    borrower: 'E004217',
    workOrder: 'WO-100',
    dueAt: '2026-11-05T16:00:00Z',
  });
  await run('tool.mark-missing', { toolId: tools.missing });
  await run('tool.retire', { toolId: tools.retired });
  const status = async (id: string) => (await read('tool.get', { id })).status as string;
  /** A count of bin A-03 sent to `clerk`, and a report of `body` on it. */
  const sent = async () =>
    (
      await run('assignment.cycle-count.create', {
        title: 'Bin A-03',
        scope: { bin: 'A-03' },
        assignee: { type: 'person', id: 'clerk' },
      })
    ).id;
  const report = async (assignmentId: string, body: { found: string[]; missing: string[] }) =>
    (
      await run(
        'assignment.cycle-count.report',
        { id: crypto.randomUUID(), assignmentId, body },
        clerk,
      )
    ).id;
  return { app, run, read, tools, status, sent, report };
}

test('attendants plan, work and review a bin count, viewers read it, and accepting sets each tool', async () => {
  const { run, read, tools, status, report } = await open();
  // Planning: a viewer may not create or send; an attendant creates a draft and sends it.
  const draft = { title: 'Bin A-03', scope: { bin: 'A-03' } };
  await expect(run('assignment.cycle-count.create', draft, viewer)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  const { id } = await run('assignment.cycle-count.create', draft);
  const to = { id, assignee: { type: 'person', id: 'clerk' } };
  await expect(run('assignment.cycle-count.send', to, viewer)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  await run('assignment.cycle-count.send', to);

  // Working: the brief lists the bin and its tools with their status, without the retired one
  // and without a tool from another bin. Only the assignee works it.
  expect(await read('assignment.feed', {}, clerk)).toMatchObject({
    items: [
      {
        id,
        brief: {
          bin: 'A-03',
          tools: [
            { assetTag: 'TC-00601', status: 'available' },
            { assetTag: 'TC-00602', status: 'checked-out' },
            { assetTag: 'TC-00603', status: 'missing' },
          ],
        },
      },
    ],
  });
  await expect(read('assignment.feed', {}, viewer)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const body = { found: ['TC-00603'], missing: ['TC-00601'] };
  for (const caller of [viewer, owner])
    await expect(
      run('assignment.cycle-count.report', { id: 'not-theirs', assignmentId: id, body }, caller),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const reportId = await report(id, body);
  await expect(run('assignment.complete', { id }, viewer)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  await run('assignment.complete', { id }, clerk);

  // Reading: a viewer sees the count and its report.
  expect(await read('assignment.list', { kind: 'cycle-count' }, viewer)).toMatchObject({
    items: [{ id, stage: 'done' }],
  });
  expect(await read('assignment.report.list', { assignmentId: id }, viewer)).toMatchObject({
    items: [{ id: reportId, body, review: 'new' }],
  });

  // Reviewing: a viewer may not accept; an attendant's accept sets TC-00601 missing and
  // TC-00603 available again, through the tool commands, and leaves the lent tool lent.
  await expect(
    run('assignment.cycle-count.accept', { id: reportId }, viewer),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(await run('assignment.cycle-count.accept', { id: reportId })).toMatchObject({
    review: 'accepted',
    reviewedBy: 'owner',
  });
  expect(await status(tools.available)).toBe('missing');
  expect(await status(tools.missing)).toBe('available');
  expect(await status(tools.lent)).toBe('checked-out');
  await expect(run('assignment.close', { id }, viewer)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  await run('assignment.close', { id }, clerk);
  expect(await read('assignment.get', { id }, viewer)).toMatchObject({ stage: 'closed' });

  // A non-member reaches none of it.
  await expect(read('assignment.feed', {}, stranger)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  await expect(read('assignment.list', {}, stranger)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
});

test('a count goes to an attendant only, and covers a bin that holds tools', async () => {
  const { run, read } = await open();
  expect(await read('assignee.list', {}, viewer)).toEqual({
    items: [
      { type: 'person', id: 'clerk', label: 'clerk' },
      { type: 'person', id: 'owner', label: 'owner' },
    ],
  });
  for (const assignee of ['viewer', 'stranger'])
    await expect(
      run('assignment.cycle-count.create', {
        title: 'Bin A-03',
        scope: { bin: 'A-03' },
        assignee: { type: 'person', id: assignee },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await expect(
    run('assignment.cycle-count.create', { title: 'Bin Z-99', scope: { bin: 'Z-99' } }),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT', message: 'No tool is in bin Z-99' });
});

test('a report naming a tag outside the bin is stored, and accepting it is refused', async () => {
  const { run, read, tools, status, sent, report } = await open();
  const id = await sent();
  // Reports name no record, so the report command stores the body as the assignee sent it.
  const outside = await report(id, { found: ['TC-00701'], missing: ['TC-00601'] });
  await expect(run('assignment.cycle-count.accept', { id: outside })).rejects.toMatchObject({
    code: 'INVALID_INPUT',
    message: 'TC-00701 is not in bin A-03',
  });
  const unknown = await report(id, { found: [], missing: ['TC-09999'] });
  await expect(run('assignment.cycle-count.accept', { id: unknown })).rejects.toMatchObject({
    code: 'INVALID_INPUT',
    message: 'TC-09999 is not in bin A-03',
  });
  const both = await report(id, { found: ['TC-00601'], missing: ['TC-00601'] });
  await expect(run('assignment.cycle-count.accept', { id: both })).rejects.toMatchObject({
    code: 'INVALID_INPUT',
  });
  // Nothing changed, the reports stay new, and an attendant discards them.
  expect(await status(tools.available)).toBe('available');
  expect(await status(tools.elsewhere)).toBe('available');
  expect(await read('assignment.report.list', { assignmentId: id, review: 'new' })).toMatchObject({
    total: 3,
  });
  await run('assignment.report.discard', { id: outside, reason: 'TC-00701 belongs in B-01' });
  expect(await read('assignment.report.get', { id: outside })).toMatchObject({
    review: 'discarded',
  });
});

test('accepting a checked-out tool reported missing is refused and changes no tool', async () => {
  const { run, read, tools, status, sent, report } = await open();
  const id = await sent();
  // TC-00601 comes first, so its tool.mark-missing runs before TC-00602's refusal.
  const reportId = await report(id, { found: [], missing: ['TC-00601', 'TC-00602'] });
  await expect(run('assignment.cycle-count.accept', { id: reportId })).rejects.toMatchObject({
    code: 'CONFLICT',
    message: 'TC-00602 is checked out; return it first',
  });
  expect(await status(tools.available)).toBe('available');
  expect(await status(tools.lent)).toBe('checked-out');
  expect(await read('assignment.report.get', { id: reportId })).toMatchObject({ review: 'new' });
});

test('tool.mark-missing and tool.mark-found move a tool between available and missing only', async () => {
  const { run, tools, status } = await open();
  await expect(run('tool.mark-missing', { toolId: tools.available }, viewer)).rejects.toMatchObject(
    { code: 'FORBIDDEN' },
  );
  for (const [toolId, message] of [
    [tools.lent, 'TC-00602 is checked out; return it first'],
    [tools.missing, 'TC-00603 is missing already'],
    [tools.retired, 'TC-00604 is retired'],
  ] as const)
    await expect(run('tool.mark-missing', { toolId })).rejects.toMatchObject({
      code: 'CONFLICT',
      message,
    });
  await expect(run('tool.mark-found', { toolId: tools.available })).rejects.toMatchObject({
    code: 'CONFLICT',
  });
  // A missing tool cannot be lent until it is found.
  await expect(
    run('tool.check-out', {
      toolId: tools.missing,
      borrower: 'E004217',
      workOrder: 'WO-101',
      dueAt: '2026-11-05T16:00:00Z',
    }),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await run('tool.mark-found', { toolId: tools.missing }, clerk)).toMatchObject({
    status: 'available',
  });
  expect(await status(tools.missing)).toBe('available');
});
