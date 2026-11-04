import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildCatalog, defineCapability, defineModule, jsonSchema } from '@tortoise/contracts';
import { connectorConformance, conformanceEffect } from '@tortoise/testing/connectors';
import { z } from 'zod';
import {
  fileDropPort,
  fileExchange,
  fileTargetPort,
  folderFeed,
  parseRecords,
  serializeRecords,
  type FileFormat,
} from '../src';
import { FakeFileConsumer, temporaryFolders } from '../src/testing';

const signal = () => new AbortController().signal;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe('formats', () => {
  const records = [
    { id: 'A-1', note: 'comma, "quote"\nline', qty: '3' },
    { id: 'A-2', note: '<&>', qty: '' },
  ];
  for (const format of ['csv', 'xml', 'json', 'ndjson'] as FileFormat[])
    test(`${format} round-trips flat records`, () => {
      expect(parseRecords(format, serializeRecords(format, records))).toEqual(records);
    });

  test('CSV reads a byte-order mark, CRLF and quoted line breaks, and refuses a ragged row', () => {
    expect(parseRecords('csv', '﻿a,b\r\n1,"x\r\ny"\r\n')).toEqual([{ a: '1', b: 'x\r\ny' }]);
    expect(() => parseRecords('csv', 'a,b\n1\n')).toThrow('has 1 fields');
    expect(() => parseRecords('csv', 'a,b\n"1,2\n')).toThrow('quoted');
  });

  test('XML refuses a document type, attributes and nested fields', () => {
    expect(() =>
      parseRecords('xml', '<!DOCTYPE x [<!ENTITY e "boom">]><records></records>'),
    ).toThrow('document type');
    expect(() => parseRecords('xml', '<records><record><a x="1">v</a></record></records>')).toThrow(
      'flat fields',
    );
    expect(() =>
      parseRecords('xml', '<records><record><a><b>v</b></a></record></records>'),
    ).toThrow('flat fields');
    expect(
      parseRecords('xml', '<records><record><a>&#x41;&amp;</a><b/></record></records>'),
    ).toEqual([{ a: 'A&', b: '' }]);
  });

  test('writing refuses a nested value instead of stringifying it', () => {
    expect(() => serializeRecords('csv', [{ a: { b: 1 } }])).toThrow('not a scalar');
  });
});

async function harness(layout: 'receipts' | 'archive') {
  const folders = await temporaryFolders(['drop', 'receipts', 'archive', 'inbox']);
  const consumer = new FakeFileConsumer({
    drop: folders.path('drop'),
    ...(layout === 'receipts' ? { receipts: folders.path('receipts') } : {}),
    archive: folders.path('archive'),
    format: 'csv',
  });
  let next = 0;
  let interrupt = false;
  const real = fileTargetPort<Record<string, unknown>>({
    target: 'erp',
    folders: folders.port,
    drop: {
      drop: 'drop',
      ...(layout === 'receipts' ? { receipts: 'receipts' } : {}),
      archive: 'archive',
      format: 'csv',
      encode: (effect) => {
        const payload = effect.payload as { order?: string; qty?: number };
        if (!payload.order) return { rejected: { code: 'NO_ORDER', message: 'No order number' } };
        return { records: [{ order: payload.order, qty: payload.qty ?? 0 }] };
      },
    },
    feed: {
      inbox: 'inbox',
      format: 'csv',
      quietMs: 0,
      map: (record, source) => ({ ...record, file: source.file }),
    },
  });
  const effect = (payload: Parameters<typeof conformanceEffect>[0]['payload']) =>
    conformanceEffect({ id: `eff-${++next}`, target: 'erp', type: 'order.post', payload });
  let changes = 0;
  return {
    port: {
      ...real,
      async deliver(item: Parameters<typeof real.deliver>[0], abort: AbortSignal) {
        const result = await real.deliver(item, abort);
        if (interrupt) {
          interrupt = false;
          throw new Error('The reply was lost');
        }
        return result;
      },
    },
    accepted: () => effect({ order: `PO-${next + 1}`, qty: 2 }),
    rejected: () => effect({ qty: 1 }),
    async applied(item: { id: string }) {
      await consumer.process();
      return consumer.applied.get(item.id) ?? 0;
    },
    failNext: () => folders.unmountNext('drop'),
    interruptNext: () => {
      interrupt = true;
    },
    async change() {
      await writeFile(
        join(folders.path('inbox'), `result-${++changes}.csv`),
        'order,status\nPO-1,done\n',
      );
    },
    close: folders.remove,
    folders,
    consumer,
  };
}

for (const layout of ['receipts', 'archive'] as const)
  describe(`file drop with ${layout}`, () => {
    for (const check of connectorConformance(() => harness(layout)))
      test(check.name, async () => {
        const result = await check.run();
        expect(result).toEqual({ passed: true });
      });
  });

describe('file drop', () => {
  test('a file is written whole under its effect ID and is pending until the receipt', async () => {
    const h = await harness('receipts');
    cleanups.push(h.close);
    const effect = h.accepted();
    expect(await h.port.deliver(effect, signal())).toEqual({
      status: 'pending',
      externalRef: `${effect.id}.csv`,
    });
    expect(await h.port.lookup!(effect.id, signal())).toEqual({
      status: 'pending',
      externalRef: `${effect.id}.csv`,
    });
    expect(await readFile(join(h.folders.path('drop'), `${effect.id}.csv`), 'utf8')).toBe(
      'order,qty\r\nPO-1,2\r\n',
    );
    await h.consumer.process();
    expect(await h.port.lookup!(effect.id, signal())).toEqual({
      status: 'accepted',
      externalRef: `DOC-${effect.id}`,
    });
  });

  test('a rejection receipt completes the effect as rejected with its code', async () => {
    const folders = await temporaryFolders(['drop', 'receipts']);
    cleanups.push(folders.remove);
    const port = fileDropPort({
      target: 'erp',
      folders: folders.port,
      drop: 'drop',
      receipts: 'receipts',
      format: 'json',
      encode: () => ({ records: [{ qty: -1 }] }),
    });
    const consumer = new FakeFileConsumer({
      drop: folders.path('drop'),
      receipts: folders.path('receipts'),
      format: 'json',
      decide: () => ({ code: 'QTY', message: 'Quantity must be positive' }),
    });
    const effect = conformanceEffect({ id: 'e1', target: 'erp', type: 'x', payload: {} });
    await port.deliver(effect, signal());
    await consumer.process();
    expect(await port.lookup!('e1', signal())).toEqual({
      status: 'rejected',
      code: 'QTY',
      message: 'Quantity must be positive',
    });
  });

  test('an unreadable receipt holds the effect instead of resending it', async () => {
    const folders = await temporaryFolders(['drop', 'receipts']);
    cleanups.push(folders.remove);
    const port = fileDropPort({
      target: 'erp',
      folders: folders.port,
      drop: 'drop',
      receipts: 'receipts',
      format: 'json',
      encode: () => ({ records: [] }),
    });
    await writeFile(join(folders.path('receipts'), 'e1.json'), '{oops');
    expect(await port.lookup!('e1', signal())).toEqual({
      status: 'uncertain',
      reason: 'The receipt for this file could not be read',
    });
  });

  test('an effect ID that would name another directory is refused', async () => {
    const folders = await temporaryFolders(['drop', 'receipts']);
    cleanups.push(folders.remove);
    const port = fileDropPort({
      target: 'erp',
      folders: folders.port,
      drop: 'drop',
      receipts: 'receipts',
      format: 'json',
      encode: () => ({ records: [] }),
    });
    const effect = conformanceEffect({ id: '../escape', target: 'erp', type: 'x', payload: {} });
    await expect(port.deliver(effect, signal())).rejects.toThrow('cannot be used as a file name');
  });

  test('a drop without receipts or archive is refused at construction', () => {
    expect(() =>
      fileDropPort({
        target: 'erp',
        folders: { folder: () => ({ id: 'x', path: '/x', access: 'write' }) },
        drop: 'drop',
        format: 'csv',
        encode: () => ({ records: [] }),
      }),
    ).toThrow('receipts or an archive');
  });
});

describe('folder feed', () => {
  test('reads only quiet files, skips hidden and foreign ones, and pages by received time', async () => {
    const folders = await temporaryFolders(['inbox']);
    cleanups.push(folders.remove);
    let now = Date.now() + 60_000;
    const pull = folderFeed({
      folders: folders.port,
      inbox: 'inbox',
      format: 'ndjson',
      maxFiles: 1,
      now: () => now,
      map: (record, source) => ({ ...record, ...source }),
    });
    const inbox = folders.path('inbox');
    await writeFile(join(inbox, 'a.ndjson'), '{"n":1}\n{"n":2}\n');
    await writeFile(join(inbox, '.b.ndjson'), '{"n":9}\n');
    await writeFile(join(inbox, 'c.txt'), 'ignored');
    const first = await pull(undefined, signal());
    expect(first.items as unknown[]).toEqual([
      { n: 1, file: 'a.ndjson', index: 0 },
      { n: 2, file: 'a.ndjson', index: 1 },
    ]);
    expect(first.more).toBe(false);
    expect((await pull(first.cursor, signal())).items).toEqual([]);
    now = Date.now() - 60_000;
    await mkdir(join(inbox, 'sub.ndjson'));
    await writeFile(join(inbox, 'd.ndjson'), '{"n":3}\n');
    expect((await pull(first.cursor, signal())).items).toEqual([]);
  });

  test('a file copied in with an old modification time is still read, and a replaced file is read again', async () => {
    const folders = await temporaryFolders(['inbox']);
    cleanups.push(folders.remove);
    const pull = folderFeed({
      folders: folders.port,
      inbox: 'inbox',
      format: 'ndjson',
      quietMs: 0,
      map: (record) => record,
    });
    const inbox = folders.path('inbox');
    await writeFile(join(inbox, 'b.ndjson'), '{"n":1}\n');
    const first = await pull(undefined, signal());
    expect(first.items).toEqual([{ n: 1 }]);
    await Bun.sleep(20);
    // A copy tool keeps the source's modification time; the status-change time is the received time.
    await writeFile(join(inbox, 'a.ndjson'), '{"n":2}\n');
    const old = new Date(Date.now() - 86_400_000);
    await utimes(join(inbox, 'a.ndjson'), old, old);
    const second = await pull(first.cursor, signal());
    expect(second.items).toEqual([{ n: 2 }]);
    await Bun.sleep(20);
    await writeFile(join(inbox, 'b.ndjson'), '{"n":3}\n');
    expect((await pull(second.cursor, signal())).items).toEqual([{ n: 3 }]);
  });

  test('a file that does not parse fails the pass rather than being skipped', async () => {
    const folders = await temporaryFolders(['inbox']);
    cleanups.push(folders.remove);
    const pull = folderFeed({
      folders: folders.port,
      inbox: 'inbox',
      format: 'json',
      quietMs: 0,
      map: (record) => record,
    });
    await writeFile(join(folders.path('inbox'), 'bad.json'), '{"items": 3}');
    await expect(pull(undefined, signal())).rejects.toThrow('array of objects');
  });
});

describe('declaration', () => {
  const component = fileExchange({
    id: 'erp-files',
    target: 'erp',
    description: 'ERP order exchange by shared folder.',
    folders: { drop: 'erp-drop', receipts: 'erp-receipts', inbox: 'erp-results' },
    dataClasses: ['purchase-order'],
  });
  const command = defineCapability({
    id: 'order.post',
    kind: 'command',
    description: 'Post an order to the ERP.',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(z.strictObject({})),
    permission: { action: 'write', resourceType: 'Order' },
    ui: { binding: 'order-post' },
    integration: { target: 'erp', delivery: 'outbox' },
  });

  test('a folder-carried outbox target needs no network destination', () => {
    const catalog = buildCatalog([defineModule({ id: 'orders', capabilities: [command] })], {
      components: [component],
    });
    expect(catalog.operations[0]!.folders).toEqual(['erp-drop']);
    expect(catalog.requirements.folders.map((folder) => [folder.id, folder.access])).toEqual([
      ['erp-drop', 'write'],
      ['erp-receipts', 'read'],
      ['erp-results', 'read'],
    ]);
  });

  test('without the folders the outbox target is refused', () => {
    expect(() => buildCatalog([defineModule({ id: 'orders', capabilities: [command] })])).toThrow(
      'no declared network destination, folder or process',
    );
  });
});
