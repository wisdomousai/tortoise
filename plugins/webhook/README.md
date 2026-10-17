# @agent-native/webhook

An example host plugin, written as a third party would write one. It posts a change notification to one declared webhook destination whenever an observed operation commits. It uses only the public plugin API: a manifest with a module, a requirement component and a setting; a state slice with a policy; a `start` hook running a loop as a delegated caller; and a status screen. `project-tasks` composes it.

Layer: plugins (`plugins/*`). It stands in for a third party's plugin: nothing in it is private framework API. It is not an application, so it has no `manifest`, `application` or `screens` entrypoint; it has the three plugin entrypoints an application lists instead.

## Primitives

This example is one [Host plugin](../../docs/primitives.md#host-plugin). It composes:

- a [Module](../../docs/primitives.md#module) of two [capabilities](../../docs/primitives.md#capability): `webhook.status.get`, bound to the status screen, and `webhook.delivery.record`, written only by the loop and documented as a UI-binding exception;
- a [Requirement declaration](../../docs/primitives.md#requirement-declaration): the `webhook-target` destination (HTTPS, site scope, `change-notification` data, queues offline), which a [Site policy](../../docs/primitives.md#site-policy) must bind before anything leaves;
- its own [Policy](../../docs/primitives.md#policy) over its slice: only the principals in `readers` read the status or record deliveries (the workspace owner by default), and its events are never disclosed.

## Entrypoints

| Import                                  | Runs in            | Contents                                                                                     |
| --------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------- |
| `@agent-native/webhook/plugin-manifest` | browser and server | `webhookPluginManifest`, `webhookDeliveryComponent`. Lists the `webhook-operations` setting. |
| `@agent-native/webhook/plugin`          | server only        | `webhookPlugin`, and `createWebhookPlugin({ intervalMs, now })` for tests.                   |
| `@agent-native/webhook/plugin-screens`  | browser            | `webhookScreens`: the `/webhook` route, a navigation item and the `webhook.` prefix.         |
| `@agent-native/webhook/*`               | see file           | `contracts` (browser-safe), `server` (state, handlers, policy), `delivery` (the loop).       |

Set the operations to observe with `--webhook-operations project.create,task.complete` or `AGENT_NATIVE_WEBHOOK_OPERATIONS`. An unknown operation refuses startup. With none set, the plugin starts nothing. Each pass reads the journal after its cursor, keeps the observed operations, posts `{ changes }` and records the receipt. The cursor lives in the plugin's slice, so a restart resumes where delivery stopped. Delivery is at least once: a crash between the post and the record repeats the post.

## Trust boundary

The loop is a caller like an agent run. It acts as the local owner narrowed by a grant to the observed operations and its own two, and that grant also filters the journal it reads. It writes only through `webhook.delivery.record`, and never touches application state. A post carries the journal entry (operation, resource id, revision), never business data. It reaches the network only through `ports.network.client('webhook-target')`. Without the network plugin the kernel refuses every post. With it, the egress guard refuses until the site policy binds `webhook-target`. Either refusal is recorded once as `lastError`, not on every pass.

Gaps: no signing of payloads and no per-destination retry backoff. The interval is fixed.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/runtime` (types), `@agent-native/host/plugin` and `@agent-native/host/plugin-manifest`, `@agent-native/frame/plugin-screens`, and `@agent-native/testing`, `@agent-native/site` and `@agent-native/network` (tests). External: `zod`, `react`, `@tanstack/react-query`, `lucide-react`; the status screen uses the starter's `@/components/ui` primitives and `@/lib/session`. A plugin never imports `apps/*` or `examples/*`; its tests use a fixture notes application.

## Tests

```sh
bun test plugins/webhook
```

`test/webhook.test.ts`:

- delivery through a fixture network-port plugin, with only observed operations posted, and the cursor surviving a restart;
- one recorded refusal when no plugin provides the network;
- the egress guard refusing the unbound destination when the site and network plugins are composed before it;
- startup refused for an unknown operation;
- a behavioral scenario through the direct driver.

The status screen's binding is checked by `examples/project-tasks/test/ui-bindings.test.ts`.

## Skills

- [write-host-plugin](../../packages/host/skills/write-host-plugin/SKILL.md): a host plugin with its own state, policy, settings and ports.
