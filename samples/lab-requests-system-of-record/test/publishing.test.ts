import { expect, test } from 'bun:test';
import type { Publication } from '../contracts';
import { open, refused, viewer } from './fixtures';

test('a published test request is registered with the LIMS id', async () => {
  const { submit, command, query, deliver, lims } = await open();
  const { id } = await submit('S-1042', 'Tensile strength of weld coupon', 'ISO 6892-1');
  await command('publication.publish', { id });
  expect(await query<Publication>('publication.get', { id })).toMatchObject({ sync: 'pending' });
  await deliver();
  expect(await query<Publication>('publication.get', { id })).toMatchObject({
    sync: 'accepted',
    sorRef: 'LIMS-1',
  });
  expect([...lims.registrations.values()][0]!.body).toMatchObject({
    requestId: id,
    specimen: 'S-1042',
    description: 'Tensile strength of weld coupon',
    method: 'ISO 6892-1',
  });
  expect(await query('lims.sync.status', {})).toMatchObject({
    accepted: 1,
    pending: 0,
    rejected: 0,
  });
});

test('the LIMS refusal lands on the publication with its reason', async () => {
  const { submit, command, query, deliver } = await open();
  const { id } = await submit('S-1043', 'No method assigned yet', '');
  await command('publication.publish', { id });
  await deliver();
  expect(await query<Publication>('publication.get', { id })).toMatchObject({
    sync: 'rejected',
    rejection: {
      code: 'NO_METHOD',
      message: 'A test request without a test method cannot be registered',
    },
  });
});

test('a reviewed publication stays pending until the lookup finds it registered', async () => {
  const { submit, command, query, deliver, lims } = await open();
  lims.reviewed = true;
  const { id } = await submit('S-1044', 'Hardness after heat treatment', 'ASTM E18');
  const { effectId } = await command<Publication>('publication.publish', { id });
  await deliver();
  expect(await query<Publication>('publication.get', { id })).toMatchObject({ sync: 'pending' });
  // A second publish waits for the LIMS's decision on the first.
  expect(await refused(command('publication.publish', { id }))).toBe('CONFLICT');
  await deliver();
  expect(await query<Publication>('publication.get', { id })).toMatchObject({ sync: 'pending' });
  lims.approve(effectId);
  await deliver();
  expect(await query<Publication>('publication.get', { id })).toMatchObject({
    sync: 'accepted',
    sorRef: 'LIMS-1',
  });
});

test('a publication the LIMS lost is held until a person resolves it', async () => {
  const { submit, command, query, deliver, lims } = await open();
  lims.reviewed = true;
  const { id } = await submit('S-1045', 'Salt spray exposure', 'ISO 9227');
  const { effectId } = await command<Publication>('publication.publish', { id });
  await deliver();
  lims.forget(effectId);
  await deliver();
  const held = await query<{ items: { id: string }[] }>('reconciliation.list', {
    resource: `publication:${id}`,
  });
  expect(held.items.map((item) => item.id)).toEqual([effectId]);
  // Resolving needs a person with the technician role.
  expect(
    await refused(command('reconciliation.resolve', { effectId, decision: 'applied' }, viewer)),
  ).toBe('FORBIDDEN');
  await command('reconciliation.resolve', {
    effectId,
    decision: 'refused',
    reason: 'Not registered in the LIMS',
  });
  expect(await query<Publication>('publication.get', { id })).toMatchObject({
    sync: 'rejected',
  });
  expect((await query<{ items: unknown[] }>('reconciliation.list', {})).items).toEqual([]);
});

test('requests registered at another site arrive once through the change feed', async () => {
  const { integrations, query, lims } = await open();
  lims.register('S-2001', 'Coating thickness on bracket', 'ISO 2178');
  await integrations.sync();
  await integrations.sync();
  const { items } = await query<{ items: { id: string; requester: string }[] }>(
    'test-request.list',
    {},
  );
  expect(items).toEqual([
    expect.objectContaining({ id: 'lims-r1', requester: 'lims-integration', method: 'ISO 2178' }),
  ]);
});

test('the integration principal may settle and sync but not change test requests', async () => {
  const { command } = await open();
  const integration = { workspaceId: 'local', principalId: 'lims-integration' };
  expect(
    await refused(command('test-request.submit', { specimen: 'x', description: 'y' }, integration)),
  ).toBe('FORBIDDEN');
  expect(await refused(command('publication.publish', { id: 'any' }, integration))).toBe(
    'FORBIDDEN',
  );
  // A viewer may read publications but not publish.
  expect(await refused(command('publication.publish', { id: 'any' }, viewer))).toBe('FORBIDDEN');
});

test('without a bound destination a publication waits in the outbox', async () => {
  const { submit, command, query, deliver, lims } = await open({ bound: false });
  const { id } = await submit('S-1046', 'Waiting for a binding', 'ISO 6892-1');
  await command('publication.publish', { id });
  await deliver();
  expect(await query<Publication>('publication.get', { id })).toMatchObject({ sync: 'pending' });
  expect(lims.registrations.size).toBe(0);
});
