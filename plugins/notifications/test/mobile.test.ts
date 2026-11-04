import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileBlobStore } from '@tortoise/adapters/blob-files';
import { bunSqlDriver } from '@tortoise/adapters/sqlite';
import {
  connectMobileShell,
  createMobilePlatform,
  openMobileInstance,
  type MobileInstance,
  type MobileOsBindings,
} from '@tortoise/mobile';
import type { ShellNotification } from '@tortoise/shell/notifications';
import { notifyAction, remindersApplication } from './fixture';

const sandboxes: string[] = [];
const opened: MobileInstance[] = [];
afterEach(async () => {
  for (const instance of opened.splice(0)) await instance.close();
  for (const sandbox of sandboxes.splice(0)) rmSync(sandbox, { recursive: true, force: true });
});

/** Wait until `check` passes, as a dispatcher pass and its backoff take a little while. */
async function until(check: () => Promise<boolean> | boolean, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Timed out');
    await Bun.sleep(10);
  }
}

async function open(
  application: ReturnType<typeof remindersApplication>,
  settings: Record<string, string> = {},
) {
  const sandbox = mkdtempSync(join(tmpdir(), 'notifications-'));
  sandboxes.push(sandbox);
  const instance = await openMobileInstance(application, {
    platform: createMobilePlatform({
      id: 'ios',
      openDatabase: (name) => bunSqlDriver(join(sandbox, name)),
      openBlobs: (workspace) => createFileBlobStore(join(sandbox, workspace, 'blobs')),
    }),
    settings: { 'os-scheme': 'dev.example.reminders', ...settings },
  });
  opened.push(instance);
  const { application: hosted } = instance.instance;
  const call = (operation: string, input: unknown, key = crypto.randomUUID()) =>
    hosted.invokeRaw({ operation, input, idempotencyKey: key }, instance.context);
  const reminders = async () =>
    (
      (await hosted.queryRaw({ operation: 'reminder.list', input: {} }, instance.context)).data as {
        reminders: { id: string; done: boolean; completions: number; sync: string }[];
      }
    ).reminders;
  return { instance, call, reminders };
}

/** The phone, faked: notifications it shows, and the buttons a person chooses on them. */
function device() {
  const shown: ShellNotification[] = [];
  let reply: ((buttons: unknown, button: string) => void) | undefined;
  const bindings: MobileOsBindings = {
    platform: 'ios',
    scheme: 'dev.example.reminders',
    initialUri: async () => null,
    subscribe: () => () => undefined,
    inspect: async () => undefined,
    read: async () => undefined,
    open: async () => undefined,
    notify: async (notification) => void shown.push(notification),
    replies: (listener) => ((reply = listener), () => (reply = undefined)),
  };
  return {
    bindings,
    shown,
    choose: (buttons: unknown, button: string) => reply?.(buttons, button),
  };
}

test('a reminder waits for the phone, shows with its button, and its reply completes it once', async () => {
  const application = remindersApplication();
  const { instance, call, reminders } = await open(application);
  instance.foreground();
  await call('reminder.create', { title: 'Buy milk' });
  // No adapter is attached yet: the effect stays pending and nothing is issued.
  await Bun.sleep(50);
  expect((await reminders())[0]).toMatchObject({ sync: 'pending' });

  const phone = device();
  const connection = connectMobileShell(instance, application, phone.bindings);
  await until(async () => (await reminders())[0]?.sync === 'accepted');
  expect(phone.shown).toHaveLength(1);
  const [notification] = phone.shown;
  expect(notification).toMatchObject({
    category: 'reminder',
    title: 'Buy milk',
    buttons: [{ id: 'done', title: 'Done', handler: 'reminder.reply' }],
  });
  // Only the buttons the effect gave a continuation are shown; the nonce is an identifier.
  expect(notification!.buttons[0]!.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);

  // A button the notification did not offer, or a forged nonce, does nothing.
  phone.choose(notification!.buttons, 'snooze');
  phone.choose([{ ...notification!.buttons[0], nonce: 'x'.repeat(43) }], 'done');
  await Bun.sleep(20);
  expect((await reminders())[0]).toMatchObject({ done: false, completions: 0 });

  phone.choose(notification!.buttons, 'done');
  await until(async () => (await reminders())[0]?.done === true);
  // The same reply again, as an OS may deliver it twice, commits nothing more.
  phone.choose(notification!.buttons, 'done');
  await Bun.sleep(20);
  expect((await reminders())[0]).toMatchObject({ done: true, completions: 1 });
  connection.close();
});

test('only the notified principal can reply, only through the shell, and only before expiry', async () => {
  let now = 1_000_000;
  const application = remindersApplication({ now: () => now, replyTtlMs: 60_000 });
  const { instance, call, reminders } = await open(application);
  const phone = device();
  const connection = connectMobileShell(instance, application, phone.bindings);
  instance.foreground();
  await call('reminder.create', { title: 'One' });
  await call('reminder.create', { title: 'Two' });
  await until(() => phone.shown.length === 2);
  const [one, two] = phone.shown.map((shown) => shown.buttons[0]!);
  const reply = (button: typeof one, principalId = 'local-user') =>
    instance.instance.ports.shell.receive(
      { workspaceId: 'local', principalId },
      { kind: 'reply', handler: button!.handler, nonce: button!.nonce, action: button!.id },
      'ios',
    );

  // Someone else on the same instance presents the local user's nonce: consumed, but nothing runs.
  expect(await reply(one, 'visitor')).toEqual({ status: 'consumed', handler: 'reminder.reply' });
  // The commands the consumer uses refuse every other channel, so no page or agent can call them.
  await expect(
    call('notification.redeem', { nonce: one!.nonce, button: 'done', handler: 'reminder.reply' }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect((await reminders()).map((item) => item.done)).toEqual([false, false]);

  await reply(one);
  now += 61_000;
  await reply(two);
  await Bun.sleep(20);
  expect((await reminders()).map((item) => item.done)).toEqual([true, false]);
  connection.close();
});

test('a payload the action does not declare, or a disabled action, completes as rejected', async () => {
  const application = remindersApplication({
    payload: (reminder, title, principal) =>
      reminder === 'r-1'
        ? { principal, category: 'unknown', title }
        : {
            principal,
            category: 'reminder',
            title,
            replies: { archive: { operation: 'reminder.complete', input: { id: reminder } } },
          },
  });
  const { instance, call, reminders } = await open(application);
  const phone = device();
  const connection = connectMobileShell(instance, application, phone.bindings);
  instance.foreground();
  await call('reminder.create', { title: 'A' });
  await call('reminder.create', { title: 'B' });
  await until(async () => (await reminders()).every((item) => item.sync === 'rejected'));
  expect(phone.shown).toEqual([]);
  connection.close();
  // One instance per workspace in a process: close this one before opening the next.
  await opened.pop()!.close();

  const disabled = remindersApplication();
  const second = await open(disabled, { 'os-disabled': 'reminders.notify' });
  const other = device();
  const otherConnection = connectMobileShell(second.instance, disabled, other.bindings);
  second.instance.foreground();
  await second.call('reminder.create', { title: 'C' });
  await until(async () => (await second.reminders())[0]?.sync === 'rejected');
  expect(other.shown).toEqual([]);
  otherConnection.close();
});

test('a notify action needs the plugin, and each target it carries needs a complete command', async () => {
  await expect(open(remindersApplication({ notifications: false }))).rejects.toThrow('notify');
  await expect(
    open(remindersApplication({ actions: [{ ...notifyAction, targets: ['elsewhere'] }] })),
  ).rejects.toThrow('carries elsewhere, which has no elsewhere.effect.complete command');
});
