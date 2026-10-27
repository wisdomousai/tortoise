# @agent-native/asset-survey-field

`asset-survey-field` is the field application of the [asset survey](../asset-survey/README.md). It runs on a phone or rugged handheld with its own workspace in [embedded mode](../../docs/glossary.md#embedded-mode), and receives the assignments the [hub](../../docs/glossary.md#hub) dispatched to it with their structure. Offline, it photographs nameplates and equipment, and it hands the captures back when it reaches the hub again. Through the OS it announces new assignments, opens the node of an asset tag another app read, raises work requests in the maintenance app and shares capture summaries.

## Layer

Content (`examples/*`). It reuses the hub's browser-safe contracts (`@agent-native/asset-survey/contracts/*`) for the capture input and the feed item, so both sides validate the same records. It never imports the hub's server code.

## Primitives

The example is one [application](../../docs/primitives.md#application), targeting `mobile`. It composes:

- one [module](../../docs/primitives.md#module), `survey-field` in [`contracts.ts`](contracts.ts), with capabilities that:
  - list assignments;
  - browse and search an assignment's nodes;
  - record a capture;
  - list captures;
  - return an assignment;
  - find an asset tag in the open assignments (`field.tag.get`);
  - settle a shown assignment notice (`assignment-notices.effect.settle`).
- a [peer target](../../docs/primitives.md#peer-target), `hub`, declared with `definePeerTarget` through the hub's field surface and wired with `connectTarget` over the peer [connector](../../docs/primitives.md#connector) `createPeerPort`. It works in two directions:
  - captures and returns go out through the [outbox](../../docs/glossary.md#outbox) to the hub's own `capture.ingest` and `assignment.return`, as `hubTarget.effect` payloads parsed by those commands' input schemas;
  - the hub's `assignment.feed` comes back through [inbound sync](../../docs/glossary.md#inbound-sync).

  A drift check (`createPeerDrift`) reads the contract the hub serves the device and compares each surface operation's schema digest. While one differs, its effects stay pending. Hub-link declares the `hub` destination, so the manifest does not list the target's peer component.
- [blob references](../../docs/primitives.md#blob-store): photos are stored on the device when taken. `field.capture.record` attaches them, so the peer connector uploads them before the record.
- [OS handlers](../../docs/primitives.md#os-handler) and [OS actions](../../docs/primitives.md#os-action) in [`os.ts`](os.ts):
  - the `intent` handler `node.from-tag` takes `dev.agentnative.survey.action.FIND_TAG` with a `tag` extra from an RFID reader or the plant's maintenance app, and opens `tag:<tag>`. The application lists `tag` among its selectable resources with `field.tag.get`, so the device checks the read before a screen opens;
  - the `intent` action `node.work-request` starts `com.example.maintenance` with the node's designation, name and the capture note;
  - the `share` action `capture.share` shares a capture's summary as text;
  - the `notify` action `assignment.notice` carries the `assignment-notices` outbox target. `applyBatch` enqueues a notice for each open assignment the feed brings for the first time.
- seven [host plugins](../../docs/primitives.md#host-plugin):
  - `hub-link` pairs the device and is its network port;
  - `os` serves the declarations, `share-target` the share action, `notifications` the notice, and `android-intents` the intents. Android intents is composed on iOS too, because startup refuses declared intents without it; there the work request is refused;
  - `managed-config` turns device-management values (`hub-url`, `enrollment-code`) into settings, so a managed device pairs on first start;
  - `intent-scanner`, on Android, takes scans from the device's imager.
- [native screens](../../docs/primitives.md#native-frame) with [capability bindings](../../docs/primitives.md#capability-binding):
  - Assignments;
  - an assignment's tree, with designation search, where a scanned tag that matches one node opens its capture;
  - Capture: camera, kind and condition chips, a note, and hold to save. On Android, a node's capture also raises a work request through `useOsAction`;
  - Unplaced captures, each with a share button;
  - Sync, with each capture's state at the hub, the hub's reason for a refusal and a share button.

  `resources.tag` in `screens-native.tsx` resolves a tag with `tagScreen` from `ui-native/os-requests.ts`, as a scan does: one node opens its capture, nodes within one assignment open its search, and anything else opens the assignment list.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/asset-survey-field/manifest` | any host | Default export: the manifest with every plugin any build composes, which `mobile:prepare` reads. |
| `@agent-native/asset-survey-field/field-application` | any host | `createFieldApplication({ plugins?, fetch?, services? })`: hub-link and the four OS plugins, then the given plugins. |
| `@agent-native/asset-survey-field/application` | React Native (Hermes) | Default export: the device build, which adds managed-config and, on Android, the intent scanner. |
| `@agent-native/asset-survey-field/screens-native` | React Native (Hermes) | Default export: `defineNativeScreens` with the field screens and the plugin screens. |
| `@agent-native/asset-survey-field/*` | see file | `contracts`, `os`, `domain`, `handlers`, `policy`, and `ui-native/*` (React Native; `os-requests` imports no React Native). |

### Scanner profile

The [scanner profile](../../docs/glossary.md#scanner-profile) in [`ui-native/shared.tsx`](ui-native/shared.tsx) is Zebra DataWedge broadcasting `dev.agentnative.SCAN`. Change it to match the device's scanner software. The profile is a constant, not a setting.

### Device run

1. Set `targets.mobile.application` in `app.config.json` to `@agent-native/asset-survey-field`, or set `AGENT_NATIVE_MOBILE_APPLICATION` for one build.
2. Run `bun run mobile:prepare`.
3. Run the mobile build scripts in [`apps/mobile`](../../apps/mobile/README.md).

## Trust boundary

The device has one person, its owner, who may call every field capability. The [integration principal](../../docs/glossary.md#integration-principal) settles `hub` outcomes and applies the hub's feed, and nothing else.

The hub decides again on every record, as `device:<id>` and within the [device link](../../docs/glossary.md#device-link) grant. Nothing on the device widens what the hub accepts. The feed is the only source of assignments, and the device never edits them.

Hub-link holds the device credential in the platform's secret store (Keystore or Keychain). The photos are stored as blobs in the application's sandbox and stay after delivery. Managed configuration is trusted as the fleet administrator's.

A scan is input under the owner's instance, like typing. It only searches and opens a screen.

An intent from another app comes from an unauthenticated sender on the device. The shell port accepts only the declared action with a `tag` extra of at most 128 characters without spaces or colons, and drops any other extra. The tag then only opens a screen; nothing commits until the person holds the save button.

The work request is an explicit intent: only `com.example.maintenance` receives it, with only the declared extras, and the person presses the button for each. The share sheet receives text the person chose to share. The notice shows the assignment title on the lock screen, which the action declares as the `assignment-title` data class. The notifications dispatcher settles a notice as the owner under its delegated grant; no screen can.

## Dependencies

- Framework:
  - `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/integration`;
  - `@agent-native/kernel`;
  - `@agent-native/frame-native`;
  - `@agent-native/devices` (scanner types).
- Plugins: `@agent-native/hub-link`, `@agent-native/os`, `@agent-native/share-target`, `@agent-native/notifications`, `@agent-native/android-intents`, `@agent-native/managed-config`, `@agent-native/intent-scanner`.
- Content: `@agent-native/asset-survey` (browser-safe contracts and domain types).
- Expo config plugins: the manifest's `expoPlugins` lists `expo-camera` with the camera permission text and no microphone. The capture screen takes stills only. `mobile:prepare` adds `expo-notifications` for the notice and `@agent-native/mobile/intent-filters` for the `FIND_TAG` filter, from the OS declarations.
- External, React Native only:
  - `react-native`, `expo-camera`, `expo-file-system`;
  - `@react-navigation/native`, `@tanstack/react-query`, `lucide-react-native`.

## Tests

```sh
bun test examples/asset-survey-field
bun run typecheck
```

`test/pipeline.test.ts` runs the hub on loopback (`startHost`). It runs the field application on the mobile platform with Bun's SQLite and files (`openMobileInstance`).

- The first test runs the full survey:
  1. The phone pairs from managed configuration.
  2. It receives the dispatched assignment and its structure, and finds a node by tag.
  3. Offline, it records a placed and an unplaced capture and returns the assignment. A later capture is refused.
  4. On reconnecting, it delivers all three, photos included. The hub answers a repeated capture ID with its first result.
  5. The hub's feed closes the assignment on the phone.
  6. At the hub, the nameplate is read, accepted and filed into the demo EAM with the photo as evidence.
- The second test covers refusals with two phones:
  - a node outside an assignment is refused on the phone;
  - a capture the hub refuses (`CONFLICT`) is shown as rejected with the hub's code.
- The third test serves a hub contract whose `capture.ingest` changed: the capture stays pending with the drift reason, and the hub receives nothing.

`test/os.test.ts` runs the same hub and phone, with the phone's OS faked through `connectMobileShell` bindings:

- A dispatched assignment shows one notice with its title, and the notice settles. A second assignment shows one more, and the first is not shown again.
- A `FIND_TAG` intent delivers `tag:=G1-Q1`, and a tag with a space or an undeclared extra is refused. `tagScreen` picks the capture for one node, the search for several, and the assignment list for none or a returned assignment.
- The work request starts the maintenance package with the declared extras only, and an undeclared extra is refused. A capture's summary goes to the share sheet as text, and a URL is refused.
- On iOS the work request is refused, and the notice is still shown.

`test/fixtures.ts` holds the hub, the phone and the pairing both test files use. `test/ui-bindings.test.ts` checks that a native screen references every field capability that claims a UI binding.

`tsconfig.native.json` type-checks the native screens; the tests do not render them. To check that Metro bundles them:

```sh
AGENT_NATIVE_MOBILE_APPLICATION=@agent-native/asset-survey-field bun run mobile:prepare
cd apps/mobile
expo export --platform android
```

The camera, scanner, managed-configuration, intent and notification paths need a device. `bunx expo config --type introspect` in `apps/mobile` after `mobile:prepare` shows the intent filter with `android.intent.category.DEFAULT` and the `expo-notifications` plugin.

## Demonstrated mechanisms

Paths in this table are relative to `examples/asset-survey-field`.

| Mechanism | Code | Proof |
| --- | --- | --- |
| [Application](../../docs/primitives.md#application) that targets mobile | `manifest.ts`: `fieldManifest` with `targets: ['mobile']` | `defineManifest` checks plugin platforms when a test loads the manifest; `apps/mobile/test/entry.test.ts` tests the `mobile:prepare` refusal |
| Embedded instance on the mobile [host platform](../../docs/primitives.md#host-platform) | `field-application.ts`: `createFieldApplication`; `apps/mobile` opens it with `openMobileInstance` | `openPhone` in `test/pipeline.test.ts` |
| Field [module](../../docs/primitives.md#module) | `contracts.ts`: `fieldModule`, `fieldOperations` | The tests in `test/pipeline.test.ts` |
| Browser-safe [capability](../../docs/primitives.md#capability) schemas shared with the hub | `contracts.ts` imports `@agent-native/asset-survey/contracts/schemas` | First pipeline test: the hub's `capture.ingest` accepts the field payload |
| [Peer target](../../docs/primitives.md#peer-target) with settle, sync and status | `contracts.ts`: `hubTarget`; `handlers.ts`: `targetHandlers` | `field.hub.status` counts in the pipeline tests |
| [Outbox effect](../../docs/primitives.md#outbox-effect) per capture and return | `handlers.ts`: `ctx.enqueue(hubTarget.effect(...))` in the capture and return handlers | First pipeline test: `retried: 3` offline, `accepted: 3` online |
| Peer [connector](../../docs/primitives.md#connector) | `field-application.ts`: `createPeerPort` inside `connectTarget` | `plugins/device-link/test/link.test.ts` (resend after a lost answer); second pipeline test (`CONFLICT` settles as rejected) |
| Drift check against the hub's contract | `field-application.ts`: `createPeerDrift` passed to `createPeerPort` | Third pipeline test |
| [Inbound sync](../../docs/primitives.md#inbound-sync) of the hub's feed | `handlers.ts`: `applyBatch` | First test: assignment and node tree arrive; the return closes the assignment |
| [Blob](../../docs/primitives.md#blob-store) attached to the forwarded resource | `handlers.ts`: `ctx.attach`; `field-application.ts`: `readEffectBlob` | First test: the hub reads the photo by digest |
| [Policy](../../docs/primitives.md#policy) with one owner and an integration lane | `policy.ts`: `fieldPolicy` | Settlement and sync in the pipeline tests; no denial test on the device |
| [Device link](../../docs/primitives.md#device-link) and the hub-link network port | `field-application.ts`: `createHubLinkPlugin` | `paired()` in `test/pipeline.test.ts` |
| Managed configuration [host plugin](../../docs/primitives.md#host-plugin) as a settings provider | `application.ts`: `managedConfigPlugin` | `openPhone` composes `createManagedConfigPlugin` with fixed values |
| Intent scanner [input source](../../docs/primitives.md#input-source) | `ui-native/shared.tsx`: `scannerProfile`, `useScans` | Type check only; `plugins/intent-scanner/test/source.test.ts` covers the source |
| [Native frame](../../docs/primitives.md#native-frame) screens | `screens-native.tsx`: `defineNativeScreens` | Type check through `tsconfig.native.json`; `test/ui-bindings.test.ts` scans the screen sources |
| [Capability binding](../../docs/primitives.md#capability-binding) through live queries | `ui-native/*.tsx`: `live.liveQueryOptions`, `client.command` | `test/ui-bindings.test.ts` |
| [UI registry](../../docs/primitives.md#ui-registry) native components | `ui-native/*.tsx`: `HoldButton`, `StatusPill`, `ListRow` | Type check through `tsconfig.native.json` only |
| Expo config plugin declared by the application, read by the [mobile starter](../../apps/mobile/README.md) | `manifest.ts`: `expoPlugins` with `expo-camera` | By-hand run in [implementation status](../../docs/implementation-status.md#mobile) |
| `intent` [OS handler](../../docs/primitives.md#os-handler) opening a selectable resource | `os.ts`: `node.from-tag`; `field-application.ts`: `selectableResources`; `screens-native.tsx`: `resources.tag` | Second test in `test/os.test.ts` |
| `intent`, `share` and `notify` [OS actions](../../docs/primitives.md#os-action) | `os.ts`; `ui-native/capture.tsx` and `ui-native/captures.tsx`: `useOsAction` | Third and fourth tests in `test/os.test.ts` |
| Notification outbox target with its settle command | `handlers.ts`: `applyBatch` and the `assignment-notices.effect.settle` handler | First test in `test/os.test.ts` |

## Structure

| Path | Holds |
| --- | --- |
| [`contracts.ts`](contracts.ts) | The `hub` peer target and the field capabilities, built with the hub's `operation` helper, which sets the UI binding and maps `forwards` to the outbox declaration |
| [`os.ts`](os.ts) | The OS handler and actions |
| [`domain.ts`](domain.ts) | `FieldState`: assignment copies, captures, returns and the feed cursor; tree order and designation search |
| [`handlers.ts`](handlers.ts) | Capability handlers and the target handlers |
| [`policy.ts`](policy.ts) | Owner role, integration lane and event access |
| [`field-application.ts`](field-application.ts) | `createFieldApplication({ plugins?, fetch?, services? })`, used by Bun tests and the device build |
| [`application.ts`](application.ts) | The device build: adds managed configuration, and the intent scanner on Android |
| [`manifest.ts`](manifest.ts) | `fieldManifest(plugins)` per build; the default export lists every plugin for `mobile:prepare` |
| [`screens-native.tsx`](screens-native.tsx) | Screen paths, tabs, capability screens, the status slot and plugin screens |
| `ui-native/` | Assignments, Assignment, Capture, Unplaced and Sync screens; `shared.tsx` holds the scanner profile; `os-requests.ts` resolves tags and builds the work request and share text |
| `test/` | The hub-and-phone fixtures, the pipeline and OS tests, and the UI binding test |

## Assignment feed flow

1. A manager dispatches a draft assignment to a paired device with the hub's `assignment.dispatch`.
2. The phone's inbound sync calls the peer port's `pull` with the stored watermark. The port posts to the hub's `assignment.feed` query through the hub-link network port, so the hub sees the caller as `device:<id>`.
3. The hub answers with every non-draft assignment of that device and its node slice. It answers an empty list when the cursor is current, and the inbound sync then stops.
4. The inbound sync submits `field.hub.sync` as the integration principal with `{ from, to, items }`. The sync handler from `targetHandlers` refuses a `from` other than the stored watermark with `CONFLICT`.
5. `applyBatch` in `handlers.ts` overwrites each assignment with the hub's copy, including its `returned` flag. The sync handler then stores the new watermark and the sync time.
6. Live queries that depend on `assignment` refetch, so the Assignments screen shows the new work.

The phone runs this pass every 5 seconds while the application is in the foreground. The test drives it with `phone.instance.integrations.sync()`.

## Capture flow

1. The Capture screen stores each photo as a blob with `transport.blobs.put` as soon as it is taken. Holding the save button calls `field.capture.record` with a new UUID as both capture ID and idempotency key.
2. The handler in `handlers.ts` refuses an unknown assignment with `NOT_FOUND` and a returned one with `CONFLICT`. An assignment is returned when the hub's feed says so or when this device sent a return.
3. It refuses a node outside the assignment with `INVALID_INPUT` and a capture ID already on the device with `CONFLICT`. A capture without a node is stored as unplaced.
4. It attaches each photo to the `capture:<id>` resource with `ctx.attach`. It enqueues an effect for target `hub` with type `capture.ingest` and the hub command's input as the payload.
5. The capture is stored with the effect ID and `sync: 'pending'`. The record, the blob references and the effect commit in one transaction.
6. `field.assignment.return` enqueues `assignment.return` after the waiting captures and stores the return as pending. The assignment then takes no further captures.
7. The dispatcher takes pending `hub` effects in creation order. For each, the peer port reads every blob the payload references with `readEffectBlob`, which returns only blobs attached to the effect's resource.
8. The port uploads each blob to the hub's `/api/v1/blobs`. It then posts the payload to `/api/v1/commands/<type>` with the effect ID as idempotency key.
9. The hub authorizes the call as `device:<id>` and runs its own ingest or return command.
10. A success settles the effect as accepted. `INVALID_INPUT`, `NOT_FOUND`, `FORBIDDEN`, `CONFLICT` or `IDEMPOTENCY_CONFLICT` settles it as rejected with the hub's code and text.
11. An unreachable hub, an unpaired device, a refused device credential or a server error leaves the effect pending. The dispatcher retries it with backoff.
12. `field.hub.settle` runs `onOutcome` in `handlers.ts`. A capture takes the outcome and any rejection; a rejected return is removed, which reopens the assignment on the device.
13. The hub's next feed marks the assignment `returned` on the device.

## Implementation steps

1. Export the field application and the hub it imports into a new directory outside the framework repository, following [create-agent-native-app](../../packages/scaffold/skills/create-agent-native-app/SKILL.md).

   ```sh
   bun run scaffold ../field-survey --name field-survey --example asset-survey-field
   ```

2. Install the dependencies from the exported lockfile. Run the command in the exported directory.

   ```sh
   bun install --frozen-lockfile
   ```

3. In `app.config.json`, change `application` to the hub and add `targets.mobile.application` for the field application, keeping the `name`, `displayName` and `appId` keys the export wrote. The export names the field application as the hosted application, which has no `screens` entrypoint and does not load in the desktop or web host.

   ```json
   {
     "application": "@agent-native/asset-survey",
     "targets": { "mobile": { "application": "@agent-native/asset-survey-field" } }
   }
   ```

4. Put the records both sides validate in the hub's browser-safe contracts and import them from the field application. The example uses `captureInputSchema` and `fieldAssignmentSchema` from `examples/asset-survey/contracts/schemas.ts`.
5. Declare the hub with `defineTarget` from `@agent-native/contracts` under the target name `hub`, which is the only target the hub-link destination serves. Give it the settled resource types, a feed of the hub's feed item and the status counts, following [connect-system-of-record](../../packages/integration/skills/connect-system-of-record/SKILL.md).
6. Declare the field module with `defineModule`, listing the device's capabilities and `hubTarget.capabilities`, following [add-capability](../../packages/runtime/skills/add-capability/SKILL.md). Each device capability carries a UI binding, and `defineTarget` gives the target's settle and sync capabilities a UI exception.
7. Write the state type and a state factory that creates it from the owner ID and the integration principal ID, as `createFieldState` in `domain.ts` does. Use the integration principal ID that step 15 passes to `connectTarget`, because the policy's integration lane admits only that ID.
8. In each sending handler, attach every blob to the record's resource with `ctx.attach(resource, ref)` and enqueue the effect with `ctx.enqueue({ target, type, resource, payload })`. Set `type` to the hub command's operation ID and `payload` to that command's input.
9. Store the effect ID that `ctx.enqueue` returns on the record, with the record's delivery state set to pending. The command that enqueues it declares `integration: { target: 'hub', delivery: 'outbox' }` in its capability.
10. Add `targetHandlers(hubTarget, { cursor, now, onOutcome, applyBatch, status })` to the handler list. `onOutcome` maps the effect's resource back to the record, and `applyBatch` writes the hub's copies.
11. Write the policy with `definePolicy` from an owner role, `targetRules(hubTarget)` and a caller rule that admits only the owner. Its integration lane admits `state.integrationPrincipalId` to `hubTarget.integrationOperations`.
12. Write a manifest builder that calls `defineManifest` with the plugin manifests one build composes, `targets: ['mobile']` and any `expoPlugins`. Pass it the application's own plugin list, because `defineApplication` refuses a plugin list whose IDs or order differ from the manifest's.
13. Export as default a manifest with every plugin any build composes, because `mobile:prepare` reads it for native config plugins.
14. Compose the application with `defineApplication` from `@agent-native/kernel/application`, passing the manifest from step 12 and using the state factory from step 7 in `createState` and `upgradeState`. List `createHubLinkPlugin()` among its plugins, because hub-link provides the network port that the peer connector uses.
15. Return the peer connector from the application's `connect`, with the integration principal ID from step 7:

   ```ts
   connect: ({ application, workspaceId, network }) => ({
     integrations: [
       connectTarget({
         application,
         workspaceId,
         principalId: 'integration',
         target: hubTarget,
         port: createPeerPort({
           target: hubTarget.target,
           client: () => network.client(hubTarget.target),
           readBlob: (effect, digest) => application.readEffectBlob(workspaceId, effect.id, digest),
           feed: 'assignment.feed',
         }),
       }),
     ],
   }),
   ```

16. Map the package's `exports` so that `./screens-native` resolves to `screens-native.tsx` and every other subpath to its `.ts` file. The entry that `mobile:prepare` generates imports the default exports of `<package>/application` and `<package>/screens-native`.
17. Write `application.ts` whose default export is the device build, picking plugins by `Platform.OS`: `managedConfigPlugin` on both platforms and `intentScannerPlugin` on Android. A host refuses to open an application that composes a plugin its platform cannot run.
18. Write `screens-native.tsx` whose default export is `defineNativeScreens(...)` from `@agent-native/frame-native/screens`, adding `hubLinkNativeScreens` and the Android-only `intentScannerScreens(profile)`. Follow [extend-mobile-host](../../packages/mobile/skills/extend-mobile-host/SKILL.md) for the screen definition.
19. Bind each screen to the session from `useSession()`, following queries with `live.liveQueryOptions` and submitting commands with an idempotency key.
20. Set the scanner profile for the device's scanner app and feed scans into the screen's search, following [add-scanner-input](../../packages/devices/skills/add-scanner-input/SKILL.md). The example's profile is Zebra DataWedge, and Honeywell devices use `dataExtra: 'data'` instead.
21. Declare what the OS may send the application and what it asks of the OS in `os.ts`, and set it as `os` on the module, following [add-os-integration](../../packages/shell/skills/add-os-integration/SKILL.md). Compose `createOsPlugin()` and the plugins that serve the declared kinds after hub-link, and list their manifests in the same order. For an `open` target, list its kind in `selectableResources` with a read query that takes `{ id }`, and resolve it to a screen in the `resources` of `defineNativeScreens`. A notify action's target needs a `<target>.effect.settle` command that calls `ctx.settleEffect` and then `ctx.change(effect.resource)`, because the outbox refuses an effect change without its resource's change.
22. On the hub, write the feed query that takes an optional `cursor` and answers `{ items, cursor, more }`. Return only the calling device's assignments and no items when the cursor is current, and page with `more` to stay within the field target's `max`.
23. On the hub, write the ingest command so that a repeated delivery of the same device-generated ID returns the first result. A different capture under the same ID conflicts.
24. On the hub, compose `createDeviceLinkPlugin({ syncOperations })` with the feed, ingest and return capabilities.
25. On the hub, add a policy lane for `device:` principals that admits only those capabilities.
26. Write a pipeline test that starts the hub with `startHost` and opens the phone with `openMobileInstance` over `createMobilePlatform`. Give the platform `bunSqlDriver`, `createFileBlobStore` and an in-memory secret store, as `test/pipeline.test.ts` does.
27. In that test, compose `createManagedConfigPlugin(() => values)` so the phone pairs from settings. Drive delivery with `dispatcher.runOnce(undefined, { ignoreBackoff: true })` and the feed with `integrations.sync()`.
28. Write a UI binding test with `unboundOperations` from `@agent-native/testing/ui-bindings`. Pass the hub-link screen directory because hub-link routes its own pairing screen, and pass `deploymentComponents(manifest)` because hub-link declares the `hub` destination.
29. Run the checks that pass in a single-example export, following [check-a-change](../../packages/testing/skills/check-a-change/SKILL.md). `bun run check` fails there for the reasons under [Limits](#limits).

   ```sh
   bun run typecheck
   bun test examples/asset-survey-field
   bun run test:portable
   bun run build
   ```

30. Check that Metro bundles the native screens, since no other check does. Run the second command in `apps/mobile`.

   ```sh
   bun run mobile:prepare
   bunx expo export --platform android
   ```

31. Generate the native projects.

   ```sh
   bun run mobile:prebuild
   ```

32. Build and install a development client with the platform's own tools. No such build is recorded on this branch.
33. Start Metro for the installed development client.

   ```sh
   bun run dev:mobile
   ```

34. Delete the generated mobile entry before the next `check:boundaries` run, because that check fails while the entry exists. Delete it again after each `mobile:prepare`, `mobile:prebuild` or `dev:mobile` run, since each script writes it.

   ```sh
   rm -rf apps/mobile/generated
   ```

The device side uses no fake system of record. The tests run the real hub on loopback. A peer that is not an agent-native host needs its own implementation of `SystemOfRecordPort` in place of the peer connector, with delivery and pull. It also needs a host plugin that provides the network port to that peer, since hub-link reaches only the paired hub and excludes another network provider.

## Limits

- **Fixed captures.** The device cannot amend, place or discard a capture, because the effect payload is fixed when it is enqueued. Placing happens on the hub during review.
- **Refused captures.** A capture the hub refuses stays on the device with the hub's reason. No capability sends it again.
- **Scanner profile.** The profile is a constant in `ui-native/shared.tsx`. Another scanner app needs a code change and a new build.
- **Scan match.** A scan opens the Capture screen only when it matches exactly one node. Otherwise it only fills the search field.
- **Feed size.** The hub's feed carries every non-draft assignment of the device in one batch, returned ones included, and the `hub` target's sync takes at most 50 items. Above that every sync pass fails with `INVALID_INPUT`, so the watermark does not move and no new assignment reaches the device.
- **Delivery order.** The dispatcher continues past an effect that is in backoff or whose delivery just failed. A return can then reach the hub before an earlier capture, which the hub still accepts.
- **Device storage.** Delivered captures and their photo blobs stay on the device. No capability removes them.
- **Foreground delivery.** Delivery and sync loops run only while the application is in the foreground. In the background the OS decides when one bounded pass runs, and iOS runs it rarely.
- **Check in an export.** The full `bun run check` fails in a single-example export at `check:readmes` on framework README links to the omitted examples. The skills check also fails on paths into those examples and on the changed root scripts, and `check:boundaries` fails while `apps/mobile/generated/` exists. The full `bun test` also fails, because the compliance controls name evidence tests in those examples.
- **Owner only.** Anyone who unlocks the device acts as its owner. The device has no per-person identity.
- **Maintenance app.** `com.example.maintenance` and its action stand for the site's maintenance app. Another app needs its package, action and extras in `os.ts` and a new build.
- **Shared text only.** A share carries the summary text. The photos stay on the device.
- **Device runs.** The native screens, camera, scanner, managed configuration, pairing, intents and notifications have not run on a device.

## Skills

- [extend-mobile-host](../../packages/mobile/skills/extend-mobile-host/SKILL.md)
- [add-os-integration](../../packages/shell/skills/add-os-integration/SKILL.md)
- [add-scanner-input](../../packages/devices/skills/add-scanner-input/SKILL.md)
- [connect-system-of-record](../../packages/integration/skills/connect-system-of-record/SKILL.md)

## References

- [Asset survey](../asset-survey/README.md)
- [Mobile host](../../docs/mobile.md)
- [System-of-record pattern](../../docs/systems-of-record.md)
- [extend-mobile-host](../../packages/mobile/skills/extend-mobile-host/SKILL.md)
- [connect-system-of-record](../../packages/integration/skills/connect-system-of-record/SKILL.md)
- [add-scanner-input](../../packages/devices/skills/add-scanner-input/SKILL.md)
- [Hub-link](../../plugins/hub-link/README.md)
- [Device-link](../../plugins/device-link/README.md)
- [Managed-config](../../plugins/managed-config/README.md)
- [Intent-scanner](../../plugins/intent-scanner/README.md)
- [OS plugin](../../plugins/os/README.md)
- [Notifications](../../plugins/notifications/README.md)
- [Android intents](../../plugins/android-intents/README.md)
- [Share target](../../plugins/share-target/README.md)
- [Implementation status](../../docs/implementation-status.md)
- [Implementation status](../../docs/implementation-status.md#mobile)
