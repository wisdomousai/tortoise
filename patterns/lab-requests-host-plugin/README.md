# @agent-native/pattern-lab-requests-host-plugin

`pattern-lab-requests-host-plugin` composes the [lab requests pattern](../lab-requests/README.md) unchanged with `activity`, a host plugin written in the pattern. The plugin counts how often the lab submits and changes test requests, per operation, from the journal and shows the counts on its own screen.

## Layer

Content (`patterns/*`). The plugin in `plugins/activity` follows the layout of a package in `plugins/*`, and the boundary check applies the same browser rules to it. It imports only the framework.

## Primitives

The pattern is one [application](../../docs/primitives.md#application) with one [host plugin](../../docs/primitives.md#host-plugin). The plugin's counting loop follows the [journal](../../docs/primitives.md#journal-and-live-query), and its tests include a [behavioral scenario](../../docs/primitives.md#behavioral-scenario). The plugin's files:

| File | Runs in | Holds |
| --- | --- | --- |
| `plugins/activity/contracts.ts` | Browser and server | The `activity` module: `activity.summary.get` and `activity.pass.record` |
| `plugins/activity/plugin-manifest.ts` | Browser and server | `definePluginManifest` with the module and the `activity-modules` setting |
| `plugins/activity/server.ts` | Server | The `activity` state slice, the handlers and the plugin's policy |
| `plugins/activity/counting.ts` | Server | The counting loop, which reads the journal under a delegated grant |
| `plugins/activity/plugin.ts` | Server | `defineHostPlugin`: state, handlers, policy and the `open` hook |
| `plugins/activity/plugin-screens.tsx`, `ui/summary.tsx` | Browser | `definePluginScreens` with the `/activity` route and navigation |

The application lists the plugin in all three entrypoints: `activityPluginManifest` in `manifest.ts`, `createActivityPlugin()` in `application.ts` and `activityScreens` in `screens.tsx`.

`open` reads the `activity-modules` setting (`--activity-modules` or `AGENT_NATIVE_ACTIVITY_MODULES`) and refuses startup when it names a module the application does not compose. Without the setting, the plugin counts the commands of every module except its own. On a serving host, `start` runs the counting loop as the local owner narrowed to a [grant](../../docs/glossary.md#grant) that lists the counted operations and the plugin's two. The loop writes only through `activity.pass.record`.

## Comparison with the webhook plugin

[`plugins/webhook`](../../plugins/webhook/README.md) has the same parts: a status query, a record command for its loop, a slice with a cursor and readers, an `open` hook that checks a setting, and a status screen. It also declares a network destination in `components` and posts through the network port. The activity plugin reaches no network, device or process, so it declares no components and needs no other plugin.

Publishing the plugin means moving the folder to the repository's `plugins/activity` with its own `package.json`, README and tests, and importing it as `@agent-native/activity`.

## Entrypoints

| Import | Runs in | Holds |
| --- | --- | --- |
| `@agent-native/pattern-lab-requests-host-plugin/manifest` | Browser and server | The lab requests module and the activity plugin manifest |
| `@agent-native/pattern-lab-requests-host-plugin/application` | Server | `createLabRequestsHostPluginApplication` |
| `@agent-native/pattern-lab-requests-host-plugin/screens` | Browser | The base pattern's screens and the activity screen |

## Trust boundary

The plugin's policy sees only the `activity` slice and decides only `activity.*` operations; the base pattern's policy decides the test request operations. Readers listed in the slice read the summary, which starts with the workspace owner, so a lab viewer is not an activity reader. The journal holds operation names, resource identifiers and revisions, so the counts contain no specimen or description and no principal. A pass at a cursor the slice already reached adds nothing, so a pass repeated after a crash does not count twice. When retention removed journal entries before the loop read them, those commands are not counted.

## Dependencies

`@agent-native/pattern-lab-requests`, `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/host` and `@agent-native/frame`.

## Tests

```sh
bun test patterns/lab-requests-host-plugin/
```

- `test/activity.test.ts`: an unknown module in the setting refuses startup. The loop counts `test-request.submit` and `test-request.update` and resumes from its cursor after a restart. A lab viewer is refused the summary, and the plugin's policy has no rule for a test request operation. A behavioral scenario records the same pass twice and counts it once.
- `test/ui-bindings.test.ts`: every bound capability is referenced by a screen in this pattern or the base.

Run the pattern in the browser:

```sh
cd patterns/lab-requests-host-plugin
bun run dev:web
```

## Skills

- [write-host-plugin](../../packages/host/skills/write-host-plugin/SKILL.md)
- [build-screens](../../packages/frame/skills/build-screens/SKILL.md)

## References

- [Patterns](../../docs/patterns.md)
- [Architecture: host plugins](../../docs/architecture.md#host-plugins)
- [Webhook plugin](../../plugins/webhook/README.md)
