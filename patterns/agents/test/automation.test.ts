import { afterEach, expect, test } from 'bun:test';
import { approvalOperations, type ApprovalRequest } from '@agent-native/contracts';
import { requestOperations } from '@agent-native/pattern-base/contracts';
import { owner, refused, startTestRequestsAgents, until, viewer } from './fixtures';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

test('a request without a method gets one only after a technician approves the trigger’s request', async () => {
  const lab = await startTestRequestsAgents();
  close = lab.close;
  const { application } = lab.host;
  const pending = async () =>
    (
      (
        await application.queryRaw(
          { operation: approvalOperations.approvalList.id, input: { status: 'pending' } },
          owner,
        )
      ).data as { items: ApprovalRequest[] }
    ).items;
  const submit = (sample: string, description: string, method: string, key: string) =>
    application.invokeRaw(
      {
        operation: requestOperations.requestSubmit.id,
        input: { sample, transformer: 'TR-40517', description, method },
        idempotencyKey: key,
      },
      owner,
    );
  const get = async (id: string) =>
    (
      await application.queryRaw(
        { operation: requestOperations.requestGet.id, input: { id } },
        owner,
      )
    ).data;

  // A trigger does nothing until a person issues a standing grant for it.
  await submit('OS-24-0700', 'Dissolved gas before the grant', '', 'before');
  const grant = await application.invokeRaw(
    {
      operation: 'automation.grant.issue',
      input: { trigger: 'suggest-methods-for-new-requests', expiresInMs: 60 * 60 * 1000 },
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
  const gasAlarm = (
    await submit('OS-24-0707', 'Dissolved gas after a Buchholz gas alarm', '', 'gas')
  ).result as { id: string };
  await submit(
    'OS-24-0708',
    'Dissolved gas analysis',
    'IEC 60567 dissolved gas analysis',
    'has-method',
  );
  await submit('OS-24-0802', 'Color and appearance', '', 'unmatched');
  await until(async () => (await pending()).length > 0);
  await Bun.sleep(50);
  const [request, ...others] = await pending();
  expect(others).toEqual([]);
  expect(request).toMatchObject({
    operation: requestOperations.requestUpdate.id,
    input: { id: gasAlarm.id, method: 'IEC 60567 dissolved gas analysis' },
    resource: `test-request:${gasAlarm.id}`,
    requestedBy: 'owner',
  });
  expect(request!.runId).toStartWith('auto:');

  // The job may not change the request itself; approving runs the update as the approver.
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
  expect(await get(gasAlarm.id)).toMatchObject({ method: 'IEC 60567 dissolved gas analysis' });

  // A technician may reject a suggestion; the request keeps no method.
  const aged = (
    await submit('OS-24-0903', 'Paper aging after 25 years in service', '', 'paper-aging')
  ).result as { id: string };
  await until(async () => (await pending()).length > 0);
  const [suggestion] = await pending();
  expect(suggestion!.input).toEqual({ id: aged.id, method: 'IEC 61198 furan analysis' });
  expect(
    await refused(
      application.invokeRaw(
        { operation: approvalOperations.approvalReject.id, input: { id: suggestion!.id } },
        viewer,
      ),
    ),
  ).toBe('FORBIDDEN');
  await application.invokeRaw(
    { operation: approvalOperations.approvalReject.id, input: { id: suggestion!.id } },
    owner,
  );
  expect(await pending()).toEqual([]);
  expect(await get(aged.id)).toMatchObject({ method: '' });

  // Revoking stops future runs.
  await application.invokeRaw(
    {
      operation: 'automation.grant.revoke',
      input: { id: (grant.result as { id: string }).id },
      idempotencyKey: 'revoke',
    },
    owner,
  );
  await submit('OS-24-0709', 'Breakdown voltage after revoking', '', 'after');
  await Bun.sleep(100);
  expect(await pending()).toEqual([]);
});
