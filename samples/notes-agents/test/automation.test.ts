import { afterEach, expect, test } from 'bun:test';
import { approvalOperations, type ApprovalRequest } from '@agent-native/contracts';
import { noteOperations } from '@agent-native/sample-notes/contracts';
import { owner, refused, startNotesAgents, until, viewer } from './fixtures';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

test('an untitled note gets a title only after a person approves the trigger’s request', async () => {
  const notes = await startNotesAgents();
  close = notes.close;
  const { application } = notes.host;
  const pending = async () =>
    (
      (
        await application.queryRaw(
          { operation: approvalOperations.approvalList.id, input: { status: 'pending' } },
          owner,
        )
      ).data as { items: ApprovalRequest[] }
    ).items;
  const add = (title: string, text: string, key: string) =>
    application.invokeRaw(
      { operation: noteOperations.noteAdd.id, input: { title, text }, idempotencyKey: key },
      owner,
    );

  // A trigger does nothing until a person issues a standing grant for it.
  await add('', 'Before the grant\nignored', 'before');
  const grant = await application.invokeRaw(
    {
      operation: 'automation.grant.issue',
      input: { trigger: 'title-new-notes', expiresInMs: 60 * 60 * 1000 },
      idempotencyKey: 'grant',
    },
    owner,
  );
  // The loop starts a new grant at the snapshot that first lists it.
  await until(async () => {
    const { data } = await application.queryRaw(
      { operation: 'automation.trigger.list', input: {} },
      owner,
    );
    return (data as { items: { cursor?: number }[] }).items[0]?.cursor !== undefined;
  });
  const { result } = await add('', 'Groceries\nmilk, bread', 'untitled');
  const note = result as { id: string };
  await add('Titled', 'Has a title already', 'titled');
  await until(async () => (await pending()).length > 0);
  await Bun.sleep(50);
  const [request, ...others] = await pending();
  expect(others).toEqual([]);
  expect(request).toMatchObject({
    operation: noteOperations.noteUpdate.id,
    input: { id: note.id, title: 'Groceries' },
    resource: `note:${note.id}`,
    requestedBy: 'owner',
  });
  expect(request!.runId).toStartWith('auto:');

  // The job may not change the note itself; approving runs the update as the approver.
  expect(
    await refused(
      application.invokeRaw(
        { operation: approvalOperations.approvalApprove.id, input: { id: request!.id } },
        viewer,
      ),
    ),
  ).toBe('FORBIDDEN');
  expect(await pending()).toHaveLength(1);
  await application.invokeRaw(
    { operation: approvalOperations.approvalApprove.id, input: { id: request!.id } },
    owner,
  );
  const titled = await application.queryRaw(
    { operation: noteOperations.noteGet.id, input: { id: note.id } },
    owner,
  );
  expect(titled.data).toMatchObject({ title: 'Groceries' });

  // Revoking stops future runs.
  await application.invokeRaw(
    {
      operation: 'automation.grant.revoke',
      input: { id: (grant.result as { id: string }).id },
      idempotencyKey: 'revoke',
    },
    owner,
  );
  await add('', 'After revoking\nignored', 'after');
  await Bun.sleep(100);
  expect(await pending()).toEqual([]);
});
