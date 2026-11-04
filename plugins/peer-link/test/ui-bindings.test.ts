import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { unboundOperations } from '@tortoise/testing/ui-bindings';
import { peerLinkModule } from '../src/contracts';

test('every peer-link operation that claims a UI binding is referenced by the peers screen', async () => {
  expect(await unboundOperations([peerLinkModule], resolve(import.meta.dir, '../src'))).toEqual([]);
});
