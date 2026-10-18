# @agent-native/webhook

An example [host plugin](../../docs/glossary.md#host-plugin), written the way a third party would write one. It posts a change notification to one declared webhook [destination](../../docs/glossary.md#destination) whenever an observed [capability](../../docs/glossary.md#capability) commits. `project-tasks` composes it.

## Layer

Plugins (`plugins/*`). The plugin uses no private framework API, so it stands in for a third party's plugin. It uses the public plugin API for:

- a manifest with a [module](../../docs/glossary.md#module), a requirement component and a setting;
- a state slice with a policy;
- a `start` hook that runs a loop as a delegated caller;
- a status [screen](../../docs/glossary.md#screen).

It is not an application, so it has no `manifest`, `application` or `screens` entrypoint. It has the three plugin entrypoints an application lists instead. It trusts the kernel's network port to apply the [site policy](../../docs/glossary.md#site-policy).

## Primitives

The plugin is one [Host plugin](../../docs/primitives.md#host-plugin). It composes:

- a [Module](../../docs/primitives.md#module) of two [capabilities](../../docs/primitives.md#capability): `webhook.status.get`, bound to the status screen, and `webhook.delivery.record`, written only by the loop and declared as a UI-binding exception;
- a [Requirement declaration](../../docs/primitives.md#requirement-declaration): the `webhook-target` destination (HTTPS, site scope, `change-notification` data, queued while offline), which a [Site policy](../../docs/primitives.md#site-policy) must bind before anything leaves;
- its own [Policy](../../docs/primitives.md#policy) over its slice: only the principals in `readers` read the status or record deliveries, and it discloses none of its events.

`readers` holds the workspace owner by default.

## Entrypoints

| Import                                  | Runs in            | Contents                                                                                     |
| --------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------- |
| `@agent-native/webhook/plugin-manifest` | browser and server | `webhookPluginManifest`, `webhookDeliveryComponent`. Lists the `webhook-operations` setting. |
| `@agent-native/webhook/plugin`          | server only        | `webhookPlugin`, and `createWebhookPlugin({ intervalMs, now })` for tests.                   |
| `@agent-native/webhook/plugin-screens`  | browser            | `webhookScreens`: the `/webhook` route, a navigation item and the `webhook.` prefix.         |
| `@agent-native/webhook/*`               | see file           | `contracts` (browser-safe), `server` (state, handlers, policy), `delivery` (the loop).       |

Set the capabilities to observe, by operation ID, with `--webhook-operations project.create,task.complete` or `AGENT_NATIVE_WEBHOOK_OPERATIONS`. An unknown operation ID refuses startup. With none set, the plugin starts nothing.

Each pass of the loop:

1. reads the [journal](../../docs/glossary.md#journal) after its cursor;
2. keeps the entries of observed capabilities;
3. posts them as `{ changes }`;
4. records the outcome with `webhook.delivery.record`.

The cursor lives in the plugin's slice, so a restart resumes where delivery stopped. Delivery is at least once: a crash between the post and the record repeats the post.

## Trust boundary

The loop is a [caller](../../docs/glossary.md#caller) like an agent run. It acts as the local owner, narrowed by a delegated [grant](../../docs/glossary.md#grant) to the observed capabilities and the plugin's own two. That grant also filters the journal the loop reads. The loop writes only through `webhook.delivery.record` and never touches application state. A post carries journal entries (operation ID, resource ID, revision) and no business data.

The loop reaches the network only through `ports.network.client('webhook-target')`. Without the network plugin, the kernel refuses every post. With it, the [egress guard](../../docs/glossary.md#egress-guard) refuses until the site policy binds `webhook-target`. The loop records a repeated refusal once, as `lastError`.

The plugin does not sign payloads and has no per-destination retry backoff. The interval is fixed.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/runtime` (types), `@agent-native/host/plugin` and `@agent-native/host/plugin-manifest`, and `@agent-native/frame/plugin-screens`. The tests also use `@agent-native/testing`, `@agent-native/site` and `@agent-native/network`.

External: `zod`, `react`, `@tanstack/react-query` and `lucide-react`. The status screen uses the starter's `@/components/ui` primitives and `@/lib/session`.

A plugin never imports `apps/*` or `examples/*`; its tests use a fixture notes application.

## Tests

```sh
bun test plugins/webhook
```

`test/webhook.test.ts` covers:

- delivery through a fixture network-port plugin, which posts only observed capabilities and keeps the cursor across a restart;
- one recorded refusal when no plugin provides the network;
- the egress guard refusing the unbound destination when the site and network plugins are composed before it;
- startup refused for an unknown operation ID;
- a behavioral scenario through the direct driver.

`examples/project-tasks/test/ui-bindings.test.ts` checks the status screen's binding.

## Skills

- [write-host-plugin](../../packages/host/skills/write-host-plugin/SKILL.md): a host plugin with its own state, policy, settings and ports.
