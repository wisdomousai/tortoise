import type { AppNames } from './application';
import type { Names } from './names';

/** The target's screen: delivery counts, the last feed sync, and a form that sends one record. */
export const targetScreen = (
  t: Names,
  one: Names,
) => `import { useQuery } from '@tanstack/react-query';
import { CapabilityForm } from '@/components/capability-form';
import { live } from '@/lib/session';
import { operations } from '../contracts';

/** Delivery to ${t.words}: what is waiting, accepted and rejected, and the last feed sync. */
export function ${t.pascal}Screen() {
  const status = useQuery(live.liveQueryOptions(operations.${t.camel}Status, {}));
  const rows: [string, string][] = [
    ['Waiting', String(status.data?.pending ?? 0)],
    ['Accepted', String(status.data?.accepted ?? 0)],
    ['Rejected', String(status.data?.rejected ?? 0)],
    [
      'Last feed sync',
      status.data?.lastSyncAt ? new Date(status.data.lastSyncAt).toLocaleString() : 'Never',
    ],
  ];
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">${t.title}</h1>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <section aria-label="Send to ${t.words}" className="space-y-3">
        <h2 className="text-base font-medium">Send ${one.a}</h2>
        <CapabilityForm capability={operations.${t.camel}Send} submitLabel="Send" />
      </section>
    </div>
  );
}
`;

/** The target's behavioral test: send, deliver, complete, feed, and who may do each. */
export const targetTest = (
  app: AppNames,
  t: Names,
  one: Names,
  many: Names,
) => `import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEmbeddedInstance } from '@tortoise/host';
import { create${app.app.pascal}Application } from '../application';
import { Fake${t.pascal} } from '../${t.kebab}-port';

const localUser = { workspaceId: 'local', principalId: 'local-user' };
const viewer = { workspaceId: 'local', principalId: 'viewer' };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function open() {
  const workspacePath = await mkdtemp(join(tmpdir(), '${app.app.kebab}-${t.kebab}-'));
  const port = new Fake${t.pascal}();
  let ids = 0;
  const instance = await openEmbeddedInstance(
    create${app.app.pascal}Application({
      members: { viewer: 'viewer' },
      ${t.camel}: port,
      services: { newId: () => \`${one.kebab}-\${++ids}\`, now: () => 1_000 },
    }),
    { workspacePath },
  );
  cleanup.push(() => rm(workspacePath, { recursive: true, force: true }));
  cleanup.push(() => instance.close());
  return { port, ...instance };
}

test('a sent ${one.words} is delivered after commit and completed; the feed adds ${many.words}', async () => {
  const { port, application, integrations } = await open();
  await application.invokeRaw(
    { operation: '${one.kebab}.create', input: { title: 'Local' }, idempotencyKey: 'create' },
    localUser,
  );
  const send = (key: string) =>
    application.invokeRaw({ operation: '${t.kebab}.send', input: { id: '${one.kebab}-1' }, idempotencyKey: key }, localUser);
  expect((await send('send')).result).toEqual({ id: '${one.kebab}-1', sync: 'pending' });
  await expect(send('again')).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await integrations.target('${t.kebab}').dispatcher.runOnce()).toMatchObject({ accepted: 1 });
  expect(port.received.size).toBe(1);
  port.publish({ id: 'remote-1', title: 'From ${t.words}' });
  await integrations.sync();
  const status = await application.queryRaw({ operation: '${t.kebab}.sync.status', input: {} }, viewer);
  expect(status.data).toMatchObject({ pending: 0, accepted: 1, rejected: 0, watermark: '1' });
  const found = await application.queryRaw({ operation: '${one.kebab}.list', input: { search: 'from' } }, viewer);
  expect(found.data).toMatchObject({ total: 1, items: [{ id: 'remote-1' }] });
});

test('viewers cannot send, and only the integration principal completes or syncs', async () => {
  const { application } = await open();
  await expect(
    application.invokeRaw({ operation: '${t.kebab}.send', input: { id: 'x' }, idempotencyKey: 'viewer' }, viewer),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    application.invokeRaw({ operation: '${t.kebab}.sync', input: { to: '1', items: [] }, idempotencyKey: 'sync' }, localUser),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
`;
