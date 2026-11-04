import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { unboundOperations } from '@tortoise/testing/ui-bindings';
import { deviceLinkModule } from '../src/contracts';

test('every device-link operation that claims a UI binding is referenced by the devices screen', async () => {
  expect(await unboundOperations([deviceLinkModule], resolve(import.meta.dir, '../src'))).toEqual(
    [],
  );
});
