import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { unboundOperations } from '@agent-native/testing/ui-bindings';
import { stationSignInModule } from '../src/contracts';

test('the badge screen references every station operation that claims a UI binding', async () => {
  expect(
    await unboundOperations([stationSignInModule], resolve(import.meta.dir, '../src')),
  ).toEqual([]);
});
