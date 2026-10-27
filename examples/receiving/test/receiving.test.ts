import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCatalog } from '@agent-native/contracts';
import { FakeFileConsumer } from '@agent-native/connector-files/testing';
import { openEmbeddedInstance } from '@agent-native/host';
import { agentGrant, type ExecutionContext } from '@agent-native/runtime';
import { createReceivingApplication } from '../application';
import { erpFolders } from '../contracts/erp-target';
import manifest from '../manifest';

const owner = { workspaceId: 'local', principalId: 'owner' };
const viewer = { workspaceId: 'local', principalId: 'viewer' };
/** The discrepancy agent, run on the owner's behalf: it may read and request approval, nothing else. */
const agent: ExecutionContext = {
  ...owner,
  runId: 'run-1',
  grant: agentGrant(
    buildCatalog(manifest.modules, { components: manifest.components }),
    'receiving.discrepancy',
    owner,
    {
      now: Date.now(),
      runId: 'run-1',
    },
  ),
};

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

const notice = [
  'id,purchaseOrder,supplier,sku,description,expected',
  'ASN-1001-1,PO-4711,Acme Fasteners,M8-40,"Hex bolt M8x40, zinc",500',
  'ASN-1001-2,PO-4711,Acme Fasteners,W8,Washer 8 mm,600',
].join('\n');

type Folder = keyof typeof erpFolders;
type Binding = { path: string } | { disabled: true; reason: string };

/** A workspace and the ERP's exchange folders, bound by a site policy file the host loads. */
async function site() {
  const directory = await mkdtemp(join(tmpdir(), 'receiving-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const path = (folder: Folder) => join(directory, 'share', erpFolders[folder]);
  for (const folder of Object.keys(erpFolders) as Folder[])
    await mkdir(path(folder), { recursive: true });
  const consumer = (decide?: ConstructorParameters<typeof FakeFileConsumer>[0]['decide']) =>
    new FakeFileConsumer({
      drop: path('drop'),
      receipts: path('receipts'),
      format: 'csv',
      ...(decide ? { decide } : {}),
    });
  async function open(bindings: Partial<Record<Folder, Binding>> = {}) {
    const policy = join(directory, 'site-policy.json');
    const folders = Object.fromEntries(
      (Object.keys(erpFolders) as Folder[]).map((folder) => [
        erpFolders[folder],
        bindings[folder] ?? { path: path(folder) },
      ]),
    );
    await writeFile(
      policy,
      JSON.stringify({ profile: 'desktop-local', audit: { mode: 'best-effort' }, folders }),
    );
    const instance = await openEmbeddedInstance(
      createReceivingApplication({
        members: { viewer: 'viewer' },
        quietMs: 0,
        services: { now: () => 1_000 },
      }),
      { workspacePath: join(directory, 'workspace'), settings: { 'site-policy': policy } },
    );
    cleanup.push(() => instance.close());
    let keys = 0;
    const command = (operation: string, input: unknown, context: ExecutionContext = owner) =>
      instance.application.invokeRaw(
        { operation, input, idempotencyKey: `${operation}-${++keys}` },
        context,
      );
    const query = (operation: string, input: unknown, context: ExecutionContext = viewer) =>
      instance.application.queryRaw({ operation, input }, context);
    const line = async (id: string) =>
      (await query('delivery.get', { id })).data as Record<string, any>;
    // Deliver now, past the retry and lookup backoff a running dispatcher would wait out.
    const deliver = () =>
      instance.integrations
        .target('erp')
        .dispatcher.runOnce(new AbortController().signal, { ignoreBackoff: true });
    // The ERP's notices only: quality inspection is not connected here.
    const sync = () => instance.integrations.target('erp').inbound.runOnce();
    return { ...instance, command, query, line, deliver, sync };
  }
  return { directory, path, consumer, open };
}

describe('receiving through the ERP exchange folders', () => {
  test('a notice becomes lines; a short count is classified by an approved approval request and posted as a file the ERP completes', async () => {
    const share = await site();
    const host = await share.open();
    await writeFile(join(share.path('inbox'), 'asn-1001.csv'), notice);
    await host.sync();
    expect(
      ((await host.query('delivery.list', { status: 'expected' })).data as any).items.map(
        (item: any) => [item.id, item.expected],
      ),
    ).toEqual([
      ['ASN-1001-1', 500],
      ['ASN-1001-2', 600],
    ]);

    await host.command('delivery.receive', { id: 'ASN-1001-1', counted: 500 });
    const counted = await host.command('delivery.receive', { id: 'ASN-1001-2', counted: 540 });
    await expect(host.command('erp.send', { id: 'ASN-1001-2' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    // The agent may read and request approval, but not classify the line itself.
    await expect(
      host.command('delivery.classify', { id: 'ASN-1001-2', reason: 'short' }, agent),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await host.query('delivery.get', { id: 'ASN-1001-2' }, agent)).toMatchObject({
      data: { counted: 540 },
    });
    const revision = counted.revisions['delivery:ASN-1001-2']!;
    const approval = await host.command(
      'approval.request',
      {
        operation: 'delivery.classify',
        input: { id: 'ASN-1001-2', reason: 'short', note: 'One carton of 60 missing' },
        rationale: 'Counted 540 of 600; the gap is one full carton.',
        confidence: 0.8,
        resource: 'delivery:ASN-1001-2',
        baseRevisions: { 'delivery:ASN-1001-2': revision },
      },
      agent,
    );
    // A viewer cannot approve: the classify command's editor rule applies to the approver.
    const id = (approval.result as { id: string }).id;
    await expect(host.command('approval.approve', { id }, viewer)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await host.command('approval.approve', { id });
    expect(await host.line('ASN-1001-2')).toMatchObject({
      reason: 'short',
      note: 'One carton of 60 missing',
    });

    await host.command('erp.send', { id: 'ASN-1001-1' });
    await host.command('erp.send', { id: 'ASN-1001-2' });
    expect(await host.deliver()).toMatchObject({ acknowledged: 2 });
    expect((await readdir(share.path('drop'))).length).toBe(2);
    expect((await host.line('ASN-1001-2')).posting).toMatchObject({ sync: 'pending' });

    const erp = share.consumer();
    await erp.process();
    expect([...erp.records.values()].flat()).toContainEqual({
      delivery: 'ASN-1001-2',
      purchaseOrder: 'PO-4711',
      sku: 'W8',
      counted: '540',
      reason: 'short',
      note: 'One carton of 60 missing',
    });
    await host.deliver();
    const posted = await host.line('ASN-1001-2');
    expect(posted).toMatchObject({ status: 'posted', posting: { sync: 'accepted' } });
    expect(posted.posting.sorRef).toStartWith('DOC-');
    expect((await host.query('erp.sync.status', {})).data).toMatchObject({
      pending: 0,
      accepted: 2,
      rejected: 0,
    });
    // A posted line is closed to further counts.
    await expect(
      host.command('delivery.receive', { id: 'ASN-1001-1', counted: 1 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  test('with the drop folder unbound a receipt waits in the outbox, and is delivered once the site binds it', async () => {
    const share = await site();
    let host = await share.open({ drop: { disabled: true, reason: 'Share not mounted yet' } });
    await writeFile(join(share.path('inbox'), 'asn-1001.csv'), notice);
    await host.sync();
    await host.command('delivery.receive', { id: 'ASN-1001-1', counted: 500 });
    await host.command('erp.send', { id: 'ASN-1001-1' });
    expect(await host.deliver()).toMatchObject({ retried: 1, acknowledged: 0 });
    expect(await readdir(share.path('drop'))).toEqual([]);
    await host.close();

    host = await share.open();
    expect(await host.deliver()).toMatchObject({
      acknowledged: 1,
    });
    await share.consumer().process();
    await host.deliver();
    expect((await host.line('ASN-1001-1')).posting).toMatchObject({ sync: 'accepted' });
  });

  test('an unreadable receipt holds the posting until an editor says whether the ERP booked it', async () => {
    const share = await site();
    const host = await share.open();
    await writeFile(join(share.path('inbox'), 'asn-1001.csv'), notice);
    await host.sync();
    await host.command('delivery.receive', { id: 'ASN-1001-1', counted: 500 });
    await host.command('erp.send', { id: 'ASN-1001-1' });
    await host.deliver();
    const effectId = (await host.line('ASN-1001-1')).posting.effectId as string;
    // The ERP picked the file up and wrote a receipt nobody can read: it may have booked it.
    await rm(join(share.path('drop'), `${effectId}.csv`));
    await writeFile(join(share.path('receipts'), `${effectId}.json`), '{ not json');
    expect(await host.deliver()).toMatchObject({ held: 1 });
    const held = async () =>
      ((await host.query('reconciliation.list', {})).data as { items: { id: string }[] }).items;
    expect((await held()).map((item) => item.id)).toEqual([effectId]);
    expect((await host.line('ASN-1001-1')).posting).toMatchObject({ sync: 'pending' });

    // A viewer may see it but not decide; an editor who found the booking completes it.
    const decision = { effectId, decision: 'applied', externalRef: 'DOC-77' };
    await expect(host.command('reconciliation.resolve', decision, viewer)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await host.command('reconciliation.resolve', decision);
    expect(await held()).toEqual([]);
    expect((await host.line('ASN-1001-1')).posting).toMatchObject({
      sync: 'accepted',
      sorRef: 'DOC-77',
    });
  });

  test('a rejected receipt reopens the line, which can be recounted and posted again', async () => {
    const share = await site();
    const host = await share.open();
    await writeFile(join(share.path('inbox'), 'asn-1001.csv'), notice);
    await host.sync();
    await host.command('delivery.receive', { id: 'ASN-1001-1', counted: 500 });
    await host.command('erp.send', { id: 'ASN-1001-1' });
    await host.deliver();
    await share.consumer(() => ({ code: 'PO_CLOSED', message: 'PO-4711 is closed' })).process();
    await host.deliver();
    expect(await host.line('ASN-1001-1')).toMatchObject({
      status: 'counted',
      posting: { sync: 'rejected', rejection: { code: 'PO_CLOSED' } },
    });
    await host.command('delivery.receive', { id: 'ASN-1001-1', counted: 499 });
    await host.command('delivery.classify', { id: 'ASN-1001-1', reason: 'damaged' });
    await host.command('erp.send', { id: 'ASN-1001-1' });
    await host.deliver();
    await share.consumer().process();
    await host.deliver();
    expect((await host.line('ASN-1001-1')).posting).toMatchObject({ sync: 'accepted' });
  });

  test('a corrected notice updates an uncounted line only, and a malformed export applies nothing', async () => {
    const share = await site();
    const host = await share.open();
    await writeFile(join(share.path('inbox'), 'asn-1001.csv'), notice);
    await host.sync();
    await host.command('delivery.receive', { id: 'ASN-1001-1', counted: 500 });
    await Bun.sleep(20);
    await writeFile(
      join(share.path('inbox'), 'asn-1001.csv'),
      notice.replace(',500', ',480').replace(',600', ',610'),
    );
    await host.sync();
    expect((await host.line('ASN-1001-1')).expected).toBe(500);
    expect((await host.line('ASN-1001-2')).expected).toBe(610);

    await Bun.sleep(20);
    await writeFile(
      join(share.path('inbox'), 'asn-1002.csv'),
      'id,purchaseOrder,supplier,sku,description,expected\nASN-1002-1,PO-4712,Acme,M6,Bolt,many',
    );
    await expect(host.sync()).rejects.toThrow('asn-1002.csv row 1');
    await expect(host.line('ASN-1002-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
