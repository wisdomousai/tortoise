import { expect, test } from 'bun:test';
import type { OsProvenance } from '@tortoise/contracts';
import { applyOsDelivery } from '../src/os-deliveries';
import { defineNativeScreens, type NativeScreenRoute } from '../src/screens';
import type { NativeSession } from '../src/session';

const Screen = () => null;
const Icon = () => null;
const route = (path: string): NativeScreenRoute => ({ path, component: Screen });
const reads: string[] = [];
const screens = defineNativeScreens({
  home: '/notes',
  routes: [route('/notes'), route('/notes/detail')],
  navigation: [{ to: '/notes', label: 'Notes', icon: Icon }],
  capabilityScreens: [{ prefix: 'notes.', to: '/notes' }],
  resources: {
    note: (id) => (reads.push(id), { to: '/notes/detail', params: { id } }),
    elsewhere: () => ({ to: '/missing' }),
  },
});
const session = {} as NativeSession;
const link: OsProvenance = { kind: 'link', handler: 'note.open' };

test('a delivery opens a declared screen, the resource screen or the form that binds it', async () => {
  const opened: [string, unknown][] = [];
  const open = (to: string, params?: Record<string, unknown>) => void opened.push([to, params]);
  await applyOsDelivery(
    { type: 'openResource', resource: 'note:n-1', provenance: link },
    screens,
    session,
    open,
  );
  await applyOsDelivery(
    { type: 'navigate', to: '/notes', search: { tab: 'all' }, provenance: link },
    screens,
    session,
    open,
  );
  await applyOsDelivery(
    {
      type: 'prepare',
      operation: 'notes.create',
      input: { title: 'Milk' },
      provenance: { kind: 'file', handler: 'note.from-text', label: 'Milk.txt' },
    },
    screens,
    session,
    open,
  );
  expect(reads).toEqual(['n-1']);
  expect(opened).toEqual([
    ['/notes/detail', { id: 'n-1' }],
    ['/notes', { tab: 'all' }],
    ['/notes', undefined],
  ]);
});

test('a target no screen declares is refused and opens nothing', async () => {
  const opened: string[] = [];
  const open = (to: string) => void opened.push(to);
  for (const delivery of [
    { type: 'navigate', to: '/admin', provenance: link },
    { type: 'openResource', resource: 'task:t-1', provenance: link },
    { type: 'openResource', resource: 'elsewhere:x', provenance: link },
  ] as const)
    await expect(applyOsDelivery(delivery, screens, session, open)).rejects.toThrow('No screen');
  expect(opened).toEqual([]);
});
