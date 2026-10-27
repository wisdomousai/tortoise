import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEmbeddedInstance } from '@agent-native/host';
import type { ExecutionContext } from '@agent-native/runtime';
import { createCrmCaptureApplication } from '../application';
import { FakeCrm } from '../fake-crm';

type Found = { externalId: string; local: string; region: string };
type Result = {
  items: Found[];
  next?: string;
  source: { status: string; identity?: string; message?: string };
};
const owner: ExecutionContext = { workspaceId: 'local', principalId: 'owner' };
/** Pat works the north and has no CRM login, so searches use the service account. */
const pat: ExecutionContext = { workspaceId: 'local', principalId: 'pat' };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function open(crm = new FakeCrm({ logins: { owner: 'ann' } })) {
  const workspacePath = await mkdtemp(join(tmpdir(), 'agent-native-crm-'));
  const instance = await openEmbeddedInstance(
    createCrmCaptureApplication({
      crm,
      members: { owner: { regions: ['north', 'south', 'west'] }, pat: { regions: ['north'] } },
    }),
    { workspacePath },
  );
  cleanup.push(() => rm(workspacePath, { recursive: true, force: true }));
  cleanup.push(() => instance.close());
  const { application, integrations } = instance;
  const query = async <T = Result>(operation: string, input: unknown, as = owner) =>
    (await application.queryRaw({ operation, input }, as)).data as T;
  const command = (operation: string, input: unknown, key: string, as = owner) =>
    application.invokeRaw({ operation, input, idempotencyKey: key }, as);
  /** One outbox pass, then one feed pass: what the background loops do every second. */
  const complete = async () => {
    await integrations.target('crm').dispatcher.runOnce();
    await integrations.sync();
  };
  return { crm, query, command, complete };
}
const ids = (result: Result) => result.items.map((item) => item.externalId);

describe('CRM capture', () => {
  test('search reads the CRM live with the caller’s own access', async () => {
    const { query } = await open();
    const acme = await query('crm.account.search', { q: 'acme' });
    expect(ids(acme)).toEqual(['001A1', '001A2']);
    expect(acme.source).toMatchObject({ status: 'ok', identity: 'caller' });
    // Ann sees Ben's public account but not his private one.
    expect(ids(await query('crm.account.search', { q: 'a' }))).toContain('001A4');
    expect(ids(await query('crm.account.search', { q: 'alpine' }))).toEqual([]);
    const contacts = await query<Result & { items: { accountId: string }[] }>(
      'crm.contact.search',
      { q: 'schulz' },
    );
    expect(contacts.items).toMatchObject([{ externalId: '003C1', accountId: '001A1' }]);
    expect(ids(await query('crm.account.lookup', { externalId: '001A3' }))).toEqual([]);
  });

  test('without a CRM login, the service account returns results page by page and only the member’s regions show', async () => {
    const { query } = await open();
    // The service account sees all ten accounts, five per page; region scoping shortens each page.
    const first = await query('crm.account.search', { q: '' }, pat);
    expect(first.source).toMatchObject({ status: 'ok', identity: 'service' });
    expect(ids(first)).toEqual(['001A1', '001A2', '001A5']);
    expect(first.next).toBeString();
    const second = await query('crm.account.search', { q: '', cursor: first.next }, pat);
    expect(ids(second)).toEqual(['001A9']);
    expect(second.next).toBeUndefined();
    expect([...first.items, ...second.items].every((item) => item.region === 'north')).toBe(true);
  });

  test('a page cursor continues only its own search, under the credential that started it', async () => {
    const { query } = await open();
    const mine = await query('crm.account.search', { q: '' });
    expect(ids(mine)).toEqual(['001A1', '001A2', '001A4', '001A5', '001A6']);
    const rest = await query('crm.account.search', { q: '', cursor: mine.next });
    expect(ids(rest)).toEqual(['001A9', '001B1']);
    const service = await query('crm.account.search', { q: '' }, pat);
    // The owner's CRM login cannot continue the service account's search: it would read past
    // the owner's sharing. Nor does a cursor carry over to another search text.
    await expect(
      query('crm.account.search', { q: '', cursor: service.next }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      query('crm.account.search', { q: 'acme', cursor: mine.next }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  test('following an account asks the CRM; the feed fills it in and keeps it current', async () => {
    const { crm, query, command, complete } = await open();
    const receipt = await command('crm.account.follow', { externalId: '001A1' }, 'follow-1');
    expect(receipt.result).toEqual({ id: '001A1', status: 'requested' });
    expect(receipt.effects).toHaveLength(1);
    expect((await query('crm.account.search', { q: 'acme robotics' })).items[0]!.local).toBe(
      'requested',
    );
    await complete();
    const followed = await query<{ name: string; status: string; owner: string }>(
      'crm.account.get',
      { id: '001A1' },
    );
    expect(followed).toMatchObject({
      status: 'following',
      name: 'Acme Robotics',
      owner: 'Ann Keller',
    });
    expect((await query('crm.account.search', { q: 'acme robotics' })).items[0]!.local).toBe(
      'following',
    );
    // Following again changes nothing and asks the CRM nothing.
    const again = await command('crm.account.follow', { externalId: '001A1' }, 'follow-2');
    expect(again.result).toEqual({ id: '001A1', status: 'following' });
    expect(again.effects).toBeUndefined();

    crm.rename('001A1', 'Acme Robotics GmbH');
    await complete();
    expect(await query<{ name: string }>('crm.account.get', { id: '001A1' })).toMatchObject({
      name: 'Acme Robotics GmbH',
    });
  });

  test('the CRM refuses to let a caller follow an account it does not share with them', async () => {
    const { query, command, complete } = await open();
    await command('crm.account.follow', { externalId: '001A3' }, 'follow-private');
    await complete();
    expect(await query('crm.account.get', { id: '001A3' })).toMatchObject({
      status: 'rejected',
      rejection: { code: 'NOT_VISIBLE' },
    });
  });

  test('activities go to the CRM after the local commit and report its outcome', async () => {
    const { crm, query, command, complete } = await open();
    await command('crm.account.follow', { externalId: '001A2' }, 'follow');
    await expect(
      command(
        'crm.activity.log',
        { accountId: '001A2', kind: 'call', summary: 'Too early', occurredAt: Date.now() },
        'early',
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await complete();
    const logged = await command(
      'crm.activity.log',
      {
        accountId: '001A2',
        kind: 'call',
        summary: 'Renewal call',
        occurredAt: Date.now() - 60_000,
      },
      'call-1',
    );
    expect(logged.result).toMatchObject({ sync: 'pending', recordedBy: 'owner' });
    await complete();
    const detail = await query<{
      activities: number;
      history: { sync: string; sorRef?: string }[];
    }>('crm.account.get', { id: '001A2' });
    expect(detail.activities).toBe(1);
    expect(detail.history[0]).toMatchObject({ sync: 'accepted', sorRef: '00T0001' });
    expect(crm.delivered().size).toBe(1);
  });

  test('when the CRM is unreachable, search reports it and followed accounts still work', async () => {
    const { crm, query, command, complete } = await open();
    await command('crm.account.follow', { externalId: '001A5' }, 'follow');
    await complete();
    crm.unavailable = true;
    const search = await query('crm.account.search', { q: 'baltic' });
    expect(search).toMatchObject({
      items: [],
      source: { status: 'unavailable', message: 'The CRM is not reachable' },
    });
    const list = await query<{ items: { id: string; status: string }[] }>('crm.account.list', {});
    expect(list.items).toMatchObject([{ id: '001A5', status: 'following' }]);
    // An activity logged now waits in the outbox instead of failing.
    const logged = await command(
      'crm.activity.log',
      { accountId: '001A5', kind: 'note', summary: 'Visited the yard', occurredAt: Date.now() },
      'offline',
    );
    expect(logged.result).toMatchObject({ sync: 'pending' });
    expect(await query<{ pending: number }>('crm.sync.status', {})).toMatchObject({ pending: 1 });
  });

  test('an agent delegated by a person searches with that person’s access, within its grant', async () => {
    const { query } = await open();
    const agent: ExecutionContext = {
      ...owner,
      runId: 'run-1',
      grant: { operations: ['crm.account.search'], runId: 'run-1', principalId: 'owner' },
    };
    const found = await query('crm.account.search', { q: 'acme' }, agent);
    expect(found.source.identity).toBe('caller');
    expect(ids(found)).toEqual(['001A1', '001A2']);
    await expect(query('crm.contact.search', { q: 'a' }, agent)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  test('people outside the workspace and the integration principal cannot search', async () => {
    const { query } = await open();
    await expect(
      query('crm.account.search', { q: 'a' }, { workspaceId: 'local', principalId: 'eve' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      query('crm.account.search', { q: 'a' }, { workspaceId: 'local', principalId: 'integration' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
