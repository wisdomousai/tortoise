# @tortoise/notifications

Shows outbox effects as desktop or phone notifications and runs the matching command when a person taps an action button. Register `notificationsPlugin` from `@tortoise/notifications/plugin` with its `plugin-manifest`, beside the OS plugin. The application declares a `notify` action whose `targets` name outbox targets with `offline: queue`, one `<target>.effect.complete` command per target, and a command that enqueues an `OsNotificationPayload`: `principal`, `category`, `title`, optional `body`, and `replies` with the `{ operation, input }` each button continues with. A reply is an OS request like any other; whoever can submit to the shell port can send one, with any nonce.

Primitives:

- [OS action](../../docs/primitives.md#os-action)
- [OS handler](../../docs/primitives.md#os-handler)
- [Connector](../../docs/primitives.md#connector)
- [Dispatcher](../../docs/primitives.md#dispatcher)
- [Host plugin](../../docs/primitives.md#host-plugin)

## References

- [add-os-integration](../../packages/shell/skills/add-os-integration/SKILL.md)
- `bun test plugins/notifications`
