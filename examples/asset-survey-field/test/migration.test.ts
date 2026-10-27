import { expect, test } from 'bun:test';
import { migrations } from '../domain';

const step = migrations.steps?.[0];
const version1 = {
  ownerId: 'owner',
  integrationPrincipalId: 'integration',
  assignments: { a1: { id: 'a1', title: 'Generator 1', kinds: ['nameplate'], nodes: [] } },
  captures: { c1: { sync: 'accepted' }, c2: { sync: 'rejected' } },
  returns: { a1: { sync: 'accepted' } },
  cursor: { watermark: 'w1', lastSyncAt: 1 },
};

test('a version 1 phone starts an empty worklist once nothing waits for the hub', () => {
  expect(step!.up(version1, 'owner')).toEqual({
    ownerId: 'owner',
    integrationPrincipalId: 'integration',
    worklist: { assignments: {}, reports: {}, cursor: {} },
  });
});

test('a version 1 phone with a capture or return still waiting is refused', () => {
  const waiting = { ...version1, captures: { ...version1.captures, c3: { sync: 'pending' } } };
  expect(() => step!.up(waiting, 'owner')).toThrow(
    'Deliver the 1 record(s) waiting for the hub with the previous version first',
  );
});
