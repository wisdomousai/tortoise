import { describe, expect, test } from 'bun:test';
import { ApplicationError, type OsDelivery } from '@tortoise/contracts';
import { UiDeliveryStore } from './ui-deliveries';

const session = (token: string, principalId = 'local-user') => ({
  token,
  context: { workspaceId: 'local', principalId },
  expiresAt: Number.MAX_SAFE_INTEGER,
});
const open = (resource: string): OsDelivery => ({
  type: 'openResource',
  resource,
  provenance: { kind: 'link', handler: 'note.open' },
});

describe('UI deliveries', () => {
  test('each session takes only its own deliveries, which expire and are revalidated', async () => {
    let now = 0;
    let readable = true;
    const store = new UiDeliveryStore({
      isActive: () => true,
      validate: async () => {
        if (!readable) throw new ApplicationError('FORBIDDEN', 'no');
      },
      now: () => now,
      ttlMs: 1000,
    });
    const id = await store.send(session('a'), open('note:1'));
    expect(await store.poll(session('b'))).toEqual([]);
    expect((await store.poll(session('a'))).map((item) => item.id)).toEqual([id]);
    readable = false;
    expect(await store.poll(session('a'))).toEqual([]);
    readable = true;
    await store.send(session('a'), open('note:2'));
    now = 2000;
    expect(await store.poll(session('a'))).toEqual([]);
  });

  test('malformed deliveries, a reused token and a full inbox are handled', async () => {
    const store = new UiDeliveryStore({ isActive: () => true, validate: async () => undefined });
    for (const delivery of [
      { ...open('note:1'), extra: true },
      { type: 'navigate', to: 'https://evil.example', provenance: { kind: 'link', handler: 'x' } },
      { type: 'navigate', to: '/a//b', provenance: { kind: 'link', handler: 'x' } },
      { type: 'prepare', operation: 'x', input: [], provenance: { kind: 'file', handler: 'x' } },
      { ...open('note:1'), provenance: { kind: 'link', handler: 'x', label: 'x'.repeat(201) } },
    ])
      await expect(store.send(session('a'), delivery as OsDelivery)).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });
    await store.send(session('a'), open('note:1'));
    await expect(store.poll(session('a', 'intruder'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    for (let index = 0; index < 20; index++) await store.send(session('a'), open(`note:${index}`));
    const pending = await store.poll(session('a'));
    expect(pending).toHaveLength(16);
    expect(pending[0]!.delivery).toMatchObject({ resource: 'note:4' });
  });
});
