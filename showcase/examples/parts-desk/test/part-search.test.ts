import { expect, test } from 'bun:test';
import { localUser, stranger, testWorkspaces, viewer } from './support';

const open = testWorkspaces('part-search');
type Found = {
  items: { partNumber: string; category: string; fits: string[] }[];
  total: number;
};

test("a serial returns only the parts that fit that transformer's model", async () => {
  const app = await open({ trialRecords: true });
  const { data } = await app.queryRaw(
    { operation: 'part.search', input: { transformerSerial: 'TR-40417', limit: 100 } },
    viewer,
  );
  const found = data as Found;
  expect(found.total).toBe(16);
  expect(found.items.every((part) => part.fits.includes('PTX-40'))).toBe(true);
  expect(found.items.map((part) => part.partNumber)).toContain('BSH-145-1250');
  expect(found.items.map((part) => part.partNumber)).not.toContain('BSH-245-1600');
  // Case does not matter, as at the phone.
  const lower = await app.queryRaw(
    { operation: 'part.search', input: { transformerSerial: 'tr-40417', limit: 100 } },
    viewer,
  );
  expect(lower.data).toEqual(data);
});

test('category and text narrow the search, and the total counts matches before paging', async () => {
  const app = await open({ trialRecords: true });
  const bushings = await app.queryRaw(
    { operation: 'part.search', input: { transformerSerial: 'TR-10008', category: 'bushing' } },
    localUser,
  );
  expect((bushings.data as Found).items.map((part) => part.partNumber)).toEqual([
    'BSH-123-2000',
    'BSH-245-1600',
    'BSH-N36-800',
  ]);
  const gaskets = await app.queryRaw(
    { operation: 'part.search', input: { text: 'TANK COVER' } },
    localUser,
  );
  expect((gaskets.data as Found).total).toBe(3);
  const first = await app.queryRaw(
    { operation: 'part.search', input: { category: 'relay', limit: 4 } },
    localUser,
  );
  const rest = await app.queryRaw(
    { operation: 'part.search', input: { category: 'relay', offset: 4, limit: 4 } },
    localUser,
  );
  expect((first.data as Found).total).toBe(6);
  expect((first.data as Found).items).toHaveLength(4);
  expect((rest.data as Found).items).toHaveLength(2);
  expect((rest.data as Found).items.every((part) => part.category === 'relay')).toBe(true);
});

test('an unknown serial is NOT_FOUND, and strangers cannot search', async () => {
  const app = await open({ trialRecords: true });
  await expect(
    app.queryRaw({ operation: 'part.search', input: { transformerSerial: 'TR-99999' } }, localUser),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(
    app.queryRaw({ operation: 'part.search', input: {} }, stranger),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
