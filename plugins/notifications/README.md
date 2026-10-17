# @agent-native/notifications

The notifications host plugin. It shows outbox effects as local notifications on the desktop or phone, and runs the command a notification's action stands for when a person chooses it. It serves the application's `notify` OS actions and `reply` OS handlers on top of the [OS plugin](../os/README.md), which it requires. Without it, startup refuses an application that declares either.

Layer: plugins (`plugins/*`), shipped with the framework. Server only, except `plugin-manifest` and `contracts`.

## Primitives

- [OS action](../../docs/primitives.md#os-action): enabling `notify` actions. `createNotificationPort` builds the notify instruction from an effect and relays it through `services.os.relay`.
- [OS handler](../../docs/primitives.md#os-handler): enabling `reply` handlers. `replyConsumer` receives the replies that name `notifications` as their consumer.
- [Connector](../../docs/primitives.md#connector): `createNotificationPort`, the outbox port of one target that a notify action carries.
- [Dispatcher](../../docs/primitives.md#dispatcher): `openNotifications` starts one dispatcher per such target. `settleOperationOf` names the settle command each one uses.
- [Host plugin](../../docs/primitives.md#host-plugin):
  - `notificationsPlugin`, `createNotificationsPlugin` and `notificationsPluginManifest`;
  - the module `notificationsModule` with `notificationOperations` and `issuedReplySchema`;
  - the slice `NotificationsState`, `ReplyRecord` and `createNotificationsState`, with `digestOf` and `newNonce`;
  - `notificationsHandlers`, `notificationsPolicy`, `NotificationsService` and `NotificationsServices`.

## Entrypoints

| Import                                        | Runs in            | Contents                                                              |
| --------------------------------------------- | ------------------ | --------------------------------------------------------------------- |
| `@agent-native/notifications`                 | server only        | Everything listed under Primitives.                                   |
| `@agent-native/notifications/plugin-manifest` | browser and server | `notificationsPluginManifest` and its module. No setting.             |
| `@agent-native/notifications/contracts`       | browser and server | `notificationsModule`, `notificationOperations`, `issuedReplySchema`. |
| `@agent-native/notifications/plugin`          | server only        | `notificationsPlugin` and `createNotificationsPlugin`.                |
| `@agent-native/notifications/*`               | server only        | One source file: `open`, `deliver`, `reply`, `handlers` or `state`.   |

What the application writes:

- A `notify` action whose `targets` name outbox targets and whose `offline` is `queue`.
- One `<target>.effect.settle` command per target. It takes `{ effectId, outcome, fence }`, as a `defineTarget` settle does, and the catalog refuses a target without one.
- A command that enqueues an effect to that target. Its payload is an `OsNotificationPayload`:
  - `principal`: who is notified;
  - `category`: a category of the action;
  - `title` and optional `body`;
  - `replies`: for each category action that should be offered, the `{ operation, input }` it continues with.

What the plugin does:

1. Once started, the dispatcher takes each pending effect. Startup is on the serving host after it listens, and on a phone at each foreground.
2. It checks the payload against the action. A payload that does not fit is settled as rejected.
3. While no adapter is attached for the notified principal, the effect stays pending, so a reminder made in the browser waits for the desktop or phone app.
4. Otherwise it creates one nonce per offered button and records their digests with `notification.issue`.
5. It relays the notification, whose id is the effect id. A repeated delivery replaces the notification instead of adding a second one.

How each platform shows it:

- Electron main uses `Notification`, with action buttons on macOS and Windows.
- The phone uses `expo-notifications`. The mobile authority registers one category per set of buttons and keeps the buttons in the notification's data, so a reply still works after the app was stopped.
- A web page shows nothing: without a service worker it has no action buttons, and the effect waits.

## Trust boundary

A reply is an OS request like any other: whoever can submit to the shell can send one, carrying any nonce. It counts only as the principal the nonce was issued to, and only once:

- The consumer looks the nonce up by its SHA-256 digest, as the submitting session.
- It redeems the nonce under a grant of exactly `notification.redeem` and the continuation found, within the session's own grant. The idempotency key is `reply:<digest>`, so a choice the OS reports twice commits once.
- `notification.redeem` drops every reply of that notification and continues with the stored command in the same transaction, as the replying caller, through the whole pipeline. The continuation is authorized when the person chooses it, not when the notification was issued.
- An unknown, used or expired nonce, one issued to someone else, or a continuation the caller may no longer run changes nothing.

Continuations are fixed when the effect commits, so a reply can choose only between commands the application wrote. Only nonce digests are stored. A nonce is 32 random bytes and lives for a day by default (`replyTtlMs`). A retried delivery issues new nonces and drops the old ones, which never reached a person.

`notification.reply.get` and `notification.redeem` are allowed only on the `shell` channel. The consumer sets that channel and no transport does, so no page, agent or MCP client can call them. `notification.issue` is allowed only for the owner acting under a delegated grant, which is the dispatcher. The dispatcher runs as the owner narrowed to `notification.issue` and the target's settle command, so a compromised adapter can drive no other command.

Who may be notified is the enqueuing command's business: the payload's `principal` is whatever that command wrote. Notification titles and bodies leave the authority for the OS's notification center and lock screen, so declare their data classes on the action. Text replies are not passed on: the `text` of a reply is ignored.

## Dependencies

- Framework: `@agent-native/contracts`, `@agent-native/kernel` (`plugin`, `plugin-manifest`, `application` types), `@agent-native/integration` (the dispatcher and `DeliveryFailure`) and `@agent-native/runtime` types.
- Plugin: `@agent-native/os`.
- Tests also use `@agent-native/mobile`, `@agent-native/shell` and `@agent-native/adapters`.
- External: `@noble/hashes` for the digest.
- `expo-notifications` is used by `@agent-native/mobile/expo`, not by this plugin.

## Tests

```sh
bun test plugins/notifications
```

`test/mobile.test.ts` runs a fixture reminders application on the mobile authority with Bun bindings for the phone. It covers:

- a reminder made before the phone attached waits, then shows with only the buttons the effect offers;
- a button the notification did not offer, or a forged nonce, does nothing, and the real reply completes the reminder once even when repeated;
- a reply as another principal, a direct call of `notification.redeem`, and a reply after expiry change nothing;
- an undeclared category or button, and an action the site turned off, settle as rejected;
- startup refused without the plugin, and a carried target without a settle command refused.

The desktop path over HTTP, from the Electron relay to the reply, is covered by `examples/project-tasks/test/os.test.ts`.

## Skills

- [add-os-integration](../../packages/shell/skills/add-os-integration/SKILL.md): OS handlers, actions and native registrations.
