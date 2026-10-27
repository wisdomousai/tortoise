import { afterEach, expect, test } from 'bun:test';
import { approvalOperations, type ApprovalRequest } from '@agent-native/contracts';
import { requestOperations } from '@agent-native/sample-lab-requests/contracts';
import { owner, refused, startLabRequestsAgents, until, viewer } from './fixtures';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

test('a request without a method gets one only after a technician approves the trigger’s request', async () => {
  const lab = await startLabRequestsAgents();
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
  const submit = (specimen: string, description: string, method: string, key: string) =>
    application.invokeRaw(
      {
        operation: requestOperations.requestSubmit.id,
        input: { specimen, description, method },
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
  await submit('Coupon 0', 'Tensile test before the grant', '', 'before');
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
  const coupon = (await submit('Coupon 7', 'Tensile strength of a welded coupon', '', 'tensile'))
    .result as { id: string };
  await submit('Coupon 8', 'Tensile test', 'ASTM E8 tensile test', 'has-method');
  await submit('Soil core 2', 'Grain size distribution', '', 'unmatched');
  await until(async () => (await pending()).length > 0);
  await Bun.sleep(50);
  const [request, ...others] = await pending();
  expect(others).toEqual([]);
  expect(request).toMatchObject({
    operation: requestOperations.requestUpdate.id,
    input: { id: coupon.id, method: 'ASTM E8 tensile test' },
    resource: `test-request:${coupon.id}`,
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
  expect(await get(coupon.id)).toMatchObject({ method: 'ASTM E8 tensile test' });

  // A technician may reject a suggestion; the request keeps no method.
  const panel = (await submit('Panel 3', 'Salt spray exposure, 96 hours', '', 'salt-spray'))
    .result as { id: string };
  await until(async () => (await pending()).length > 0);
  const [suggestion] = await pending();
  expect(suggestion!.input).toEqual({ id: panel.id, method: 'ASTM B117 salt spray' });
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
  expect(await get(panel.id)).toMatchObject({ method: '' });

  // Revoking stops future runs.
  await application.invokeRaw(
    {
      operation: 'automation.grant.revoke',
      input: { id: (grant.result as { id: string }).id },
      idempotencyKey: 'revoke',
    },
    owner,
  );
  await submit('Coupon 9', 'Hardness after revoking', '', 'after');
  await Bun.sleep(100);
  expect(await pending()).toEqual([]);
});
