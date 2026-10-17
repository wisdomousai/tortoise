import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { unboundOperations } from '@agent-native/testing/ui-bindings';
import { hubLinkModule } from '../src/contracts';

test('every hub-link operation that claims a UI binding is referenced by the pairing screen', async () => {
  expect(await unboundOperations([hubLinkModule], resolve(import.meta.dir, '../src'))).toEqual([]);
});
