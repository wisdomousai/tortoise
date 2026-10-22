import { expect, test } from 'bun:test';
import type { Publication } from '../contracts';
import { open, refused, viewer } from './fixtures';

test('a published note is accepted with the publisher’s id', async () => {
  const { note, command, query, deliver, publisher } = await open();
  const { id } = await note('Groceries', 'milk, bread');
  await command('publication.publish', { id });
  expect(await query<Publication>('publication.get', { id })).toMatchObject({ sync: 'pending' });
  await deliver();
  expect(await query<Publication>('publication.get', { id })).toMatchObject({
    sync: 'accepted',
    sorRef: 'pub-1',
  });
  expect([...publisher.publications.values()][0]!.body).toMatchObject({
    noteId: id,
    title: 'Groceries',
    text: 'milk, bread',
  });
  expect(await query('publisher.sync.status', {})).toMatchObject({
    accepted: 1,
    pending: 0,
    rejected: 0,
  });
});

test('the publisher’s refusal lands on the publication with its reason', async () => {
  const { note, command, query, deliver } = await open();
  const { id } = await note('Empty', '');
  await command('publication.publish', { id });
  await deliver();
  expect(await query<Publication>('publication.get', { id })).toMatchObject({
    sync: 'rejected',
    rejection: { code: 'EMPTY_NOTE', message: 'A note without text cannot be published' },
  });
});

test('a moderated publication stays pending until the lookup finds it live', async () => {
  const { note, command, query, deliver, publisher } = await open();
  publisher.moderated = true;
  const { id } = await note('Draft', 'for review');
  const { effectId } = await command<Publication>('publication.publish', { id });
  await deliver();
  expect(await query<Publication>('publication.get', { id })).toMatchObject({ sync: 'pending' });
  // A second publish waits for the publisher's decision on the first.
  expect(await refused(command('publication.publish', { id }))).toBe('CONFLICT');
  await deliver();
  expect(await query<Publication>('publication.get', { id })).toMatchObject({ sync: 'pending' });
  publisher.approve(effectId);
  await deliver();
  expect(await query<Publication>('publication.get', { id })).toMatchObject({
    sync: 'accepted',
    sorRef: 'pub-1',
  });
});

test('a publication the publisher lost is held until a person resolves it', async () => {
  const { note, command, query, deliver, publisher } = await open();
  publisher.moderated = true;
  const { id } = await note('Lost', 'somewhere');
  const { effectId } = await command<Publication>('publication.publish', { id });
  await deliver();
  publisher.forget(effectId);
  await deliver();
  const held = await query<{ items: { id: string }[] }>('reconciliation.list', {
    resource: `publication:${id}`,
  });
  expect(held.items.map((item) => item.id)).toEqual([effectId]);
  // Resolving needs a person with the editor role.
  expect(
    await refused(command('reconciliation.resolve', { effectId, decision: 'applied' }, viewer)),
  ).toBe('FORBIDDEN');
  await command('reconciliation.resolve', {
    effectId,
    decision: 'refused',
    reason: 'Not on the publisher’s site',
  });
  expect(await query<Publication>('publication.get', { id })).toMatchObject({
    sync: 'rejected',
  });
  expect((await query<{ items: unknown[] }>('reconciliation.list', {})).items).toEqual([]);
});

test('notes posted on the publisher’s site arrive once through the change feed', async () => {
  const { integrations, query, publisher } = await open();
  publisher.post('From the site', 'posted there');
  await integrations.sync();
  await integrations.sync();
  const { items } = await query<{ items: { id: string; author: string }[] }>('note.list', {});
  expect(items).toEqual([
    expect.objectContaining({ id: 'site-p1', author: 'publisher-integration' }),
  ]);
});

test('the integration principal may settle and sync but not change notes', async () => {
  const { command } = await open();
  const integration = { workspaceId: 'local', principalId: 'publisher-integration' };
  expect(await refused(command('note.add', { title: 'x', text: 'y' }, integration))).toBe(
    'FORBIDDEN',
  );
  expect(await refused(command('publication.publish', { id: 'any' }, integration))).toBe(
    'FORBIDDEN',
  );
  // A viewer may read publications but not publish.
  expect(await refused(command('publication.publish', { id: 'any' }, viewer))).toBe('FORBIDDEN');
});

test('without a bound destination a publication waits in the outbox', async () => {
  const { note, command, query, deliver, publisher } = await open({ bound: false });
  const { id } = await note('Waiting', 'for a binding');
  await command('publication.publish', { id });
  await deliver();
  expect(await query<Publication>('publication.get', { id })).toMatchObject({ sync: 'pending' });
  expect(publisher.publications.size).toBe(0);
});
