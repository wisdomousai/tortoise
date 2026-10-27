# @agent-native/notifications

The notifications host plugin shows outbox [effects](../../docs/glossary.md#effect) as local notifications on the desktop or phone. When a person chooses a notification's action, the plugin runs the [command](../../docs/glossary.md#command) that action stands for. It serves the application's `notify` [OS actions](../../docs/glossary.md#os-action) and `reply` [OS handlers](../../docs/glossary.md#os-handler) on top of the [OS plugin](../os/README.md), which it requires. Without this plugin, startup refuses an application that declares either.

## Layer

Plugins (`plugins/*`), shipped with the framework. Server only, except `plugin-manifest` and `contracts`.

## Primitives

- [OS action](../../docs/primitives.md#os-action): enabling `notify` actions. `createNotificationPort` builds the notify instruction from an effect and relays it through `services.os.relay`.
- [OS handler](../../docs/primitives.md#os-handler): enabling `reply` handlers. `replyConsumer` receives the replies that name `notifications` as their consumer.
- [Connector](../../docs/primitives.md#connector): `createNotificationPort`, the outbox port of one [target](../../docs/glossary.md#target) that a notify action carries.
- [Dispatcher](../../docs/primitives.md#dispatcher): `openNotifications` starts one [dispatcher](../../docs/glossary.md#dispatcher) per such target. `settleOperationOf` names the settle command each one uses.
- [Host plugin](../../docs/primitives.md#host-plugin):
  - `notificationsPlugin`, `createNotificationsPlugin` and `notificationsPluginManifest`, whose operations keep the namespace `notification`;
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

### Application declarations

The application writes:

- a `notify` action whose `targets` name outbox targets and whose `offline` is `queue`;
- one `<target>.effect.settle` command per target, which takes `{ effectId, outcome, fence }` as a `defineTarget` settle does; the [catalog](../../docs/glossary.md#catalog) refuses a target without one;
- a command that enqueues an effect to that target, with an `OsNotificationPayload` as its payload.

The payload holds:

- `principal`: who is notified;
- `category`: a category of the action;
- `title` and optional `body`;
- `replies`: for each category action that should be offered, the `{ operation, input }` it continues with.

### Delivery

1. Once started, the dispatcher takes each pending effect. It starts on the serving host after the host listens, and on a phone at each foreground.
2. The dispatcher checks the payload against the action. A payload that does not fit is settled as rejected.
3. While no adapter is attached for the notified [principal](../../docs/glossary.md#principal), the effect stays pending. A reminder made in the browser therefore waits for the desktop or phone host.
4. Otherwise the dispatcher creates one nonce per offered button and records their digests with `notification.issue`.
5. The dispatcher relays the notification, whose ID is the effect ID. A repeated delivery replaces the notification instead of adding a second one.

Each platform shows the notification as follows:

- **Electron main** uses `Notification`, with action buttons on macOS and Windows.
- **The phone** uses `expo-notifications`. The mobile instance registers one category per set of buttons and keeps the buttons in the notification's data, so a reply still works after the application was stopped.
- **A browser** shows nothing. Without a service worker it has no action buttons, and the effect waits.

## Trust boundary

A reply is an OS request like any other. Whoever can submit to the shell port can send one, carrying any nonce. A reply counts only as the principal the nonce was issued to, and only once:

- The consumer looks the nonce up by its SHA-256 digest, as the submitting [session](../../docs/glossary.md#session).
- The consumer redeems the nonce under a [grant](../../docs/glossary.md#grant) of exactly `notification.redeem` and the continuation found, within the session's own grant. The [idempotency key](../../docs/glossary.md#idempotency-key) is `reply:<digest>`, so a choice the OS reports twice commits once.
- `notification.redeem` drops every reply of that notification. In the same transaction it continues with the stored command as the replying caller, through the whole pipeline.
- The [continuation](../../docs/glossary.md#continuation) is authorized when the person chooses it, and issuing the notification does not authorize it.
- An unknown, used or expired nonce changes nothing. Neither does a nonce issued to someone else, or a continuation the caller may no longer run.

Continuations are fixed when the effect commits, so a reply can choose only between commands the application wrote. Only nonce digests are stored. A nonce is 32 random bytes and lives for a day by default (`replyTtlMs`). A retried delivery issues new nonces and drops the old ones, which never reached a person.

`notification.reply.get` and `notification.redeem` are allowed only on the `shell` [channel](../../docs/glossary.md#channel). The consumer sets that channel and no surface does, so no screen, agent run or MCP client can call them. `notification.issue` is allowed only for the [owner](../../docs/glossary.md#owner) acting under a delegated grant, which is the dispatcher. The dispatcher runs as the owner narrowed to `notification.issue` and the target's settle command. A compromised adapter can therefore drive no other command.

The enqueuing command decides who may be notified, because the payload's `principal` is whatever that command wrote. Notification titles and bodies leave the instance for the OS's notification center and lock screen, so declare their data classes on the action. Text replies are not passed on, and the `text` of a reply is ignored.

## Dependencies

- Framework:
  - `@agent-native/contracts`, and `@agent-native/runtime` for types;
  - `@agent-native/kernel`: `plugin`, `plugin-manifest` and the `application` types;
  - `@agent-native/integration`: the dispatcher and `DeliveryFailure`.
- Plugin: `@agent-native/os`.
- Tests also use `@agent-native/mobile`, `@agent-native/shell` and `@agent-native/adapters`.
- External: `@noble/hashes` for the digest, and `zod`.
- `expo-notifications` is used by `@agent-native/mobile/expo`, not by this plugin.

## Tests

```sh
bun test plugins/notifications
```

`test/mobile.test.ts` runs a fixture reminders application on the mobile instance, with Bun bindings for the phone. It covers:

- a reminder made before the phone attached, which waits and then shows with only the buttons the effect offers;
- a button the notification did not offer, or a forged nonce, which does nothing;
- the real reply, which completes the reminder once even when repeated;
- a reply as another principal, a direct call of `notification.redeem`, and a reply after expiry, which change nothing;
- an undeclared category or button, and an action the site turned off, which settle as rejected;
- startup refused without the plugin, and a carried target without a settle command refused.

`examples/field-service/test/os.test.ts` covers the desktop path over HTTP, from the Electron relay to the reply. `examples/asset-survey-field/test/os.test.ts` covers a phone: a notice without buttons that inbound sync queues, shown once per new assignment and settled.

## Skills

- [add-os-integration](../../packages/shell/skills/add-os-integration/SKILL.md): OS handlers, actions and native registrations.
