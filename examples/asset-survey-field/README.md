# @agent-native/asset-survey-field

`asset-survey-field` is the field application of the [asset survey](../asset-survey/README.md). It runs on a phone or rugged handheld with its own workspace in [embedded mode](../../docs/glossary.md#embedded-mode), and keeps a [worklist](../../docs/glossary.md#worklist) of the surveys the [hub](../../docs/glossary.md#hub) sent it. Offline, it photographs nameplates and equipment, and it delivers the captures as reports when it reaches the hub again.

## Layer

Content (`examples/*`). It imports the hub's browser-safe contracts (`@agent-native/asset-survey/contracts/*`) for the survey kind and the hub's device surface, so both sides validate the same records. It never imports the hub's server code.

## Primitives

The example is one [application](../../docs/primitives.md#application), targeting `mobile`. It composes:

- a [worklist](../../docs/primitives.md#worklist) in [`contracts.ts`](contracts.ts), declared with `defineWorklist` over the hub's `survey` kind with namespace `field`, target `hub` and lane `device`. Its module has:
  - `field.assignment.list`, `field.assignment.get` and `field.assignment.complete`;
  - `field.survey.report` for one capture, and `field.report.list`;
  - the target's `field.hub.settle`, `field.hub.sync` and `field.hub.status`.
- a [peer target](../../docs/primitives.md#peer-target), `hub`, from the worklist, connected with `connectWorklist`. It works in two directions:
  - captures and done marks go out through the [outbox](../../docs/glossary.md#outbox) to the hub's own `assignment.survey.report` and `assignment.complete`;
  - the hub's `assignment.feed` comes back through [inbound sync](../../docs/glossary.md#inbound-sync).

  A drift check reads the contract the hub serves the device and compares each surface operation's schema digest. While one differs, its effects stay pending. Hub-link declares the `hub` destination, so the manifest does not list the target's peer component.
- [blob references](../../docs/primitives.md#blob-store): photos are stored on the device when taken. The report command attaches them, so the peer connector uploads them before the report.
- a [state migration](../../docs/primitives.md#state-migration) to version 2 in [`domain.ts`](domain.ts), for workspaces of the previous version.
- three [host plugins](../../docs/primitives.md#host-plugin):
  - `hub-link` pairs the device and is its network port;
  - `managed-config` turns device-management values (`hub-url`, `enrollment-code`) into settings, so a managed device pairs on first start;
  - `intent-scanner`, on Android, takes scans from the device's imager.
- [native screens](../../docs/primitives.md#native-frame) with [capability bindings](../../docs/primitives.md#capability-binding):
  - Assignments, from the registry's `worklist-list`;
  - a survey's tree from its brief, with designation search, where a scanned tag that matches one node opens its capture;
  - Capture: camera, kind and condition chips, a note, and hold to save;
  - Unplaced captures;
  - Sync, from the registry's `worklist-sync`, with each capture's state at the hub and the hub's reason for a refusal.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/asset-survey-field/manifest` | any host | Default export: the manifest with every plugin any build composes, which `mobile:prepare` reads. |
| `@agent-native/asset-survey-field/field-application` | any host | `createFieldApplication({ plugins?, fetch?, services? })`: hub-link plus the given plugins. |
| `@agent-native/asset-survey-field/application` | React Native (Hermes) | Default export: the device build, which adds managed-config and, on Android, the intent scanner. |
| `@agent-native/asset-survey-field/screens-native` | React Native (Hermes) | Default export: `defineNativeScreens` with the field screens and the plugin screens. |
| `@agent-native/asset-survey-field/*` | see file | `contracts`, `domain`, `policy`, and `ui-native/*` (React Native). |

### Scanner profile

The [scanner profile](../../docs/glossary.md#scanner-profile) in [`ui-native/shared.tsx`](ui-native/shared.tsx) is Zebra DataWedge broadcasting `dev.agentnative.SCAN`. Change it to match the device's scanner software. The profile is a constant, not a setting.

### Device run

1. Set `targets.mobile.application` in `app.config.json` to `@agent-native/asset-survey-field`, or set `AGENT_NATIVE_MOBILE_APPLICATION` for one build.
2. Run `bun run mobile:prepare`.
3. Run the mobile build scripts in [`apps/mobile`](../../apps/mobile/README.md).

## Trust boundary

The device has one person, its owner, who may call every field capability. The [integration principal](../../docs/glossary.md#integration-principal) settles `hub` outcomes and applies the hub's feed, and nothing else.

The hub decides again on every report and done mark, as `device:<id>` and within the [device link](../../docs/glossary.md#device-link) grant. The hub's assignment feature takes them only for surveys sent to that device. Nothing on the device widens what the hub accepts. The feed is the only source of surveys, and the device never edits them.

The device does not check a capture's node against the survey. The hub stores a capture on a node the survey does not cover without its node, and a reviewer places it.

Hub-link holds the device credential in the platform's secret store (Keystore or Keychain). The photos are stored as blobs in the application's sandbox and stay after delivery. Managed configuration is trusted as the fleet administrator's.

A scan is input under the owner's instance, like typing. It only searches and opens a screen.

## Dependencies

- Framework:
  - `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/assignments`;
  - `@agent-native/kernel`;
  - `@agent-native/frame-native`;
  - `@agent-native/devices` (scanner types).
- Plugins: `@agent-native/hub-link`, `@agent-native/managed-config`, `@agent-native/intent-scanner`.
- Content: `@agent-native/asset-survey` (browser-safe contracts).
- Expo config plugin: the manifest's `expoPlugins` lists `expo-camera` with the camera permission text and no microphone. The capture screen takes stills only.
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
  2. It receives the survey with its brief, draws the tree and finds a node by tag.
  3. Offline, it records a placed and an unplaced capture and marks the survey done. A later capture is refused with `CONFLICT`.
  4. On reconnecting, it delivers all three, photos included. Delivering again changes nothing at the hub.
  5. The hub's next feed no longer lists the survey, so the phone closes it.
  6. At the hub, the nameplate is read, accepted and filed into the demo EAM with the photo as evidence.
- The second test runs two phones. Each lists only its own survey. A capture on a node outside the survey arrives at the hub unplaced. A capture under an ID the hub already holds is refused with `CONFLICT` and shown as rejected.
- The third test serves a hub contract whose `assignment.survey.report` changed: the capture stays pending with the drift reason, and the hub receives nothing.

`test/migration.test.ts` upgrades a version 1 workspace with nothing waiting to an empty worklist, and refuses one with a capture still waiting for the hub.

`test/ui-bindings.test.ts` checks that a native screen references every field capability that claims a UI binding.

`tsconfig.native.json` type-checks the native screens; the tests do not render them. To check that Metro bundles them:

```sh
AGENT_NATIVE_MOBILE_APPLICATION=@agent-native/asset-survey-field bun run mobile:prepare
cd apps/mobile
expo export --platform android
```

The camera, scanner and managed-configuration paths need a device.

## Demonstrated mechanisms

Paths in this table are relative to `examples/asset-survey-field`.

| Mechanism | Code | Proof |
| --- | --- | --- |
| [Application](../../docs/primitives.md#application) that targets mobile | `manifest.ts`: `fieldManifest` with `targets: ['mobile']` | `defineManifest` checks plugin platforms when a test loads the manifest; `apps/mobile/test/entry.test.ts` tests the `mobile:prepare` refusal |
| Embedded instance on the mobile [host platform](../../docs/primitives.md#host-platform) | `field-application.ts`: `createFieldApplication`; `apps/mobile` opens it with `openMobileInstance` | `openPhone` in `test/pipeline.test.ts` |
| [Worklist](../../docs/primitives.md#worklist) over the hub's survey kind | `contracts.ts`: `worklist`; `field-application.ts`: `worklistHandlers` | The tests in `test/pipeline.test.ts` |
| [Outbox effect](../../docs/primitives.md#outbox-effect) per capture and done mark | `worklistHandlers` in `packages/assignments` | First pipeline test: `retried: 3` offline, `accepted: 3` online |
| Peer [connector](../../docs/primitives.md#connector) and drift check | `field-application.ts`: `connectWorklist` | Second pipeline test (`CONFLICT` settles as rejected); third pipeline test (drift) |
| [Inbound sync](../../docs/primitives.md#inbound-sync) of the hub's feed | `connectWorklist` | First test: the survey arrives, and the next feed closes it |
| [Blob](../../docs/primitives.md#blob-store) attached to the forwarded report | `worklistHandlers`: `ctx.attach` | First test: the hub reads the photo by digest |
| [State migration](../../docs/primitives.md#state-migration) to the worklist | `domain.ts`: `migrations` | `test/migration.test.ts` |
| [Policy](../../docs/primitives.md#policy) with one owner and an integration lane | `policy.ts`: `fieldPolicy` with `worklistRules` | Settlement and sync in the pipeline tests; no denial test on the device |
| [Device link](../../docs/primitives.md#device-link) and the hub-link network port | `field-application.ts`: `createHubLinkPlugin` | `paired()` in `test/pipeline.test.ts` |
| Managed configuration [host plugin](../../docs/primitives.md#host-plugin) as a settings provider | `application.ts`: `managedConfigPlugin` | `openPhone` composes `createManagedConfigPlugin` with fixed values |
| Intent scanner [input source](../../docs/primitives.md#input-source) | `ui-native/shared.tsx`: `scannerProfile`, `useScans` | Type check only; `plugins/intent-scanner/test/source.test.ts` covers the source |
| [Native frame](../../docs/primitives.md#native-frame) screens | `screens-native.tsx`: `defineNativeScreens` | Type check through `tsconfig.native.json`; `test/ui-bindings.test.ts` scans the screen sources |
| [Capability binding](../../docs/primitives.md#capability-binding) through live queries | `ui-native/*.tsx`: `live.liveQueryOptions`, `client.command` | `test/ui-bindings.test.ts` |
| [UI registry](../../docs/primitives.md#ui-registry) native components | `ui-native/*.tsx`: `WorklistList`, `WorklistSync`, `HoldButton`, `StatusPill`, `ListRow` | Type check through `tsconfig.native.json` only |
| Expo config plugin declared by the application, read by the [mobile starter](../../apps/mobile/README.md) | `manifest.ts`: `expoPlugins` with `expo-camera` | By-hand run in [implementation status](../../docs/implementation-status.md#mobile) |

## Structure

| Path | Holds |
| --- | --- |
| [`contracts.ts`](contracts.ts) | The worklist over the hub's survey kind and device surface, and its flat operations |
| [`domain.ts`](domain.ts) | `FieldState`: the owner, the integration principal and the worklist slice; the version 2 migration |
| [`policy.ts`](policy.ts) | Owner role, the worklist rules, the integration lane and event access |
| [`field-application.ts`](field-application.ts) | `createFieldApplication({ plugins?, fetch?, services? })`, used by Bun tests and the device build |
| [`application.ts`](application.ts) | The device build: adds managed configuration, and the intent scanner on Android |
| [`manifest.ts`](manifest.ts) | `fieldManifest(plugins)` per build; the default export lists every plugin for `mobile:prepare` |
| [`screens-native.tsx`](screens-native.tsx) | Screen paths, tabs, capability screens, the status slot and plugin screens |
| `ui-native/` | Assignments, Assignment, Capture, Unplaced and Sync screens; `shared.tsx` holds the scanner profile, and `brief.ts` a brief's tree order and designation search |
| `test/` | The hub-and-phone pipeline test, the migration test and the UI binding test |

## Survey feed flow

1. A manager sends a survey to a paired device with the hub's `assignment.survey.create` or `assignment.survey.send`. The hub computes its brief, the kinds of capture wanted and the structure slice under the survey's roots.
2. The phone's inbound sync calls the peer port's `pull` with the stored watermark. The port posts to the hub's `assignment.feed` query through the hub-link network port, so the hub sees the caller as `device:<id>`.
3. The hub answers with every survey sent to that device that is not yet done, with its brief. It answers an empty list when the cursor is current, and the inbound sync then stops.
4. The inbound sync submits `field.hub.sync` as the integration principal. The worklist replaces its held copies with the hub's and closes each survey the feed no longer lists, which then takes no more captures.
5. Live queries that depend on the worklist's assignments refetch, so the Assignments screen shows the new work.

The phone runs this pass every 5 seconds while the application is in the foreground. The test drives it with `phone.instance.integrations.sync()`.

## Capture flow

1. The Capture screen stores each photo as a blob with `transport.blobs.put` as soon as it is taken. Holding the save button calls `field.survey.report` with the survey, the node when one is chosen, and the capture body, under a new idempotency key.
2. The worklist refuses an unknown survey with `NOT_FOUND`, and one that is done or no longer listed with `CONFLICT`. It gives the report a new ID, which the hub keeps.
3. It attaches each photo to the report's resource and enqueues an effect for target `hub` with the hub's `assignment.survey.report` input as the payload. The report, the blob references and the effect commit in one transaction.
4. `field.assignment.complete` enqueues `assignment.complete` after the waiting captures, and the survey takes no further captures.
5. The dispatcher takes pending `hub` effects in creation order. For each, the peer port reads every blob the payload references with `readEffectBlob`, which returns only blobs attached to the effect's resource.
6. The port uploads each blob to the hub's `/api/v1/blobs`. It then posts the payload to `/api/v1/commands/<type>` with the effect ID as idempotency key.
7. The hub authorizes the call as `device:<id>` and runs its own report or done command.
8. A success settles the effect as accepted. `INVALID_INPUT`, `NOT_FOUND`, `FORBIDDEN` or `CONFLICT` settles it as rejected with the hub's code and text.
9. `IDEMPOTENCY_CONFLICT` holds the effect, because the hub holds a different command under the effect's key and the outcome is unknown. An unreachable hub, an unpaired device, a refused device credential or a server error leaves the effect pending, and the dispatcher retries it with backoff.
10. `field.hub.settle` records the outcome on the report or the done mark. A refused done mark reopens the survey on the device.

## Version 1 workspaces

The state is at version 2. A workspace written by version 1 is upgraded when it is first read. It starts with an empty worklist, and the next feed brings back the surveys still open for the device. The captures the hub took are at the hub. The step refuses a workspace with a capture or a return still waiting for the hub; deliver it with version 1 first. Hub-link keeps the pairing, so the device is not paired again.

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

4. On the hub, declare the survey kind with the `device` lane and a peer surface from `assignments.lanes.device`, both in browser-safe contracts, following [assign-work](../../packages/assignments/skills/assign-work/SKILL.md). The example's are in `examples/asset-survey/contracts/kinds.ts` and `contracts/peer.ts`.
5. Declare the worklist with `defineWorklist({ namespace, target: 'hub', assignments, issuer, lane: 'device', destination })`. Name the target `hub`, which is the only target the hub-link destination serves. Export its `operations` flat, so screens bind them by name.
6. Write the state type and a state factory that creates it from the owner ID, the integration principal ID and `createWorklistSlice()`, as `createFieldState` in `domain.ts` does. Use the integration principal ID that step 11 passes to `connectWorklist`, because the policy's integration lane admits only that ID.
7. Write the policy with `definePolicy` from an owner role, `worklistRules(worklist)` and a caller rule that admits only the owner. Its integration lane admits `state.integrationPrincipalId` to `worklist.target.integrationOperations`, and its event rules cover `worklist.types.assignment`, `worklist.types.report` and `sync`.
8. Write a manifest builder that calls `defineManifest` with `worklist.module`, the plugin manifests one build composes, `targets: ['mobile']` and any `expoPlugins`. Pass it the application's own plugin list, because `defineApplication` refuses a plugin list whose IDs or order differ from the manifest's.
9. Export as default a manifest with every plugin any build composes, because `mobile:prepare` reads it for native config plugins.
10. Compose the application with `defineApplication` from `@agent-native/kernel/application`, passing the manifest from step 8, the state factory from step 6 and `worklistHandlers(worklist, { slice, newId, now })`. List `createHubLinkPlugin()` among its plugins, because hub-link provides the network port that the peer connector uses.
11. Return the worklist's integration from the application's `connect`, with the integration principal ID from step 6:

   ```ts
   connect: ({ application, workspaceId, network }) => ({
     integrations: [
       connectWorklist(worklist, {
         application,
         workspaceId,
         principalId: 'integration',
         client: () => network.client(worklist.target.target),
       }),
     ],
   }),
   ```

12. Map the package's `exports` so that `./screens-native` resolves to `screens-native.tsx` and every other subpath to its `.ts` file. The entry that `mobile:prepare` generates imports the default exports of `<package>/application` and `<package>/screens-native`.
13. Write `application.ts` whose default export is the device build, picking plugins by `Platform.OS`: `managedConfigPlugin` on both platforms and `intentScannerPlugin` on Android. A host refuses to open an application that composes a plugin its platform cannot run.
14. Write `screens-native.tsx` whose default export is `defineNativeScreens(...)` from `@agent-native/frame-native/screens`, adding `hubLinkNativeScreens` and the Android-only `intentScannerScreens(profile)`. Follow [extend-mobile-host](../../packages/mobile/skills/extend-mobile-host/SKILL.md) for the screen definition.
15. Bind each screen to the session from `useSession()`, following queries with `live.liveQueryOptions` and submitting commands with an idempotency key. Use the registry's `worklist-list` and `worklist-sync` from `packages/frame-native` for the list and the sync state, and draw the brief in the application's own screen.
16. Set the scanner profile for the device's scanner app and feed scans into the screen's search, following [add-scanner-input](../../packages/devices/skills/add-scanner-input/SKILL.md). The example's profile is Zebra DataWedge, and Honeywell devices use `dataExtra: 'data'` instead.
17. On the hub, compose `createDeviceLinkPlugin({ syncOperations: assignments.lanes.device.operations })`. The assignment feature's policy matches `device:<id>` as the assignee, so the hub's own policy has no device lane.
18. Write a pipeline test that starts the hub with `startHost` and opens the phone with `openMobileInstance` over `createMobilePlatform`. Give the platform `bunSqlDriver`, `createFileBlobStore` and an in-memory secret store, as `test/pipeline.test.ts` does.
19. In that test, compose `createManagedConfigPlugin(() => values)` so the phone pairs from settings. Drive delivery with `dispatcher.runOnce(undefined, { ignoreBackoff: true })` and the feed with `integrations.sync()`.
20. Write a UI binding test with `unboundOperations` from `@agent-native/testing/ui-bindings`. Pass the hub-link screen directory because hub-link routes its own pairing screen, and pass `deploymentComponents(manifest)` because hub-link declares the `hub` destination.
21. Run the checks that pass in a single-example export, following [check-a-change](../../packages/testing/skills/check-a-change/SKILL.md). `bun run check` fails there for the reasons under [Limits](#limits).

   ```sh
   bun run typecheck
   bun test examples/asset-survey-field
   bun run test:portable
   bun run build
   ```

22. Check that Metro bundles the native screens, since no other check does. Run the second command in `apps/mobile`.

   ```sh
   bun run mobile:prepare
   bunx expo export --platform android
   ```

23. Generate the native projects.

   ```sh
   bun run mobile:prebuild
   ```

24. Build and install a development client with the platform's own tools. No such build is recorded on this branch.
25. Start Metro for the installed development client.

   ```sh
   bun run dev:mobile
   ```

26. Delete the generated mobile entry before the next `check:boundaries` run, because that check fails while the entry exists. Delete it again after each `mobile:prepare`, `mobile:prebuild` or `dev:mobile` run, since each script writes it.

   ```sh
   rm -rf apps/mobile/generated
   ```

The device side uses no fake system of record. The tests run the real hub on loopback. A peer that is not an agent-native host needs its own implementation of `SystemOfRecordPort` in place of the peer connector, with delivery and pull. It also needs a host plugin that provides the network port to that peer, since hub-link reaches only the paired hub and excludes another network provider.

## Limits

- **Fixed captures.** The device cannot amend, place or discard a capture, because the effect payload is fixed when it is enqueued. Placing happens on the hub during review.
- **Refused captures.** A capture the hub refuses stays on the device with the hub's reason. No capability sends it again.
- **Scanner profile.** The profile is a constant in `ui-native/shared.tsx`. Another scanner app needs a code change and a new build.
- **Scan match.** A scan opens the Capture screen only when it matches exactly one node. Otherwise it only fills the search field.
- **Brief photos.** A survey's brief carries no photos or documents, because the feed pull downloads no blobs.
- **Delivery order.** The dispatcher continues past an effect that is in backoff or whose delivery just failed. A done mark can then reach the hub before an earlier capture, which the hub still accepts.
- **Device storage.** Delivered captures and their photo blobs stay on the device. No capability removes them.
- **Foreground delivery.** Delivery and sync loops run only while the application is in the foreground. In the background the OS decides when one bounded pass runs, and iOS runs it rarely.
- **Check in an export.** The full `bun run check` fails in a single-example export at `check:readmes` on framework README links to the omitted examples. The skills check also fails on paths into those examples and on the changed root scripts, and `check:boundaries` fails while `apps/mobile/generated/` exists. The full `bun test` also fails, because the compliance controls name evidence tests in those examples.
- **Owner only.** Anyone who unlocks the device acts as its owner. The device has no per-person identity.
- **Device runs.** The native screens, camera, scanner, managed configuration and pairing have not run on a device.

## Skills

- [assign-work](../../packages/assignments/skills/assign-work/SKILL.md)
- [extend-mobile-host](../../packages/mobile/skills/extend-mobile-host/SKILL.md)
- [add-scanner-input](../../packages/devices/skills/add-scanner-input/SKILL.md)

## References

- [Asset survey](../asset-survey/README.md)
- [Assignments](../../docs/assignments.md)
- [Mobile host](../../docs/mobile.md)
- [Assignments package](../../packages/assignments/README.md)
- [extend-mobile-host](../../packages/mobile/skills/extend-mobile-host/SKILL.md)
- [add-scanner-input](../../packages/devices/skills/add-scanner-input/SKILL.md)
- [Hub-link](../../plugins/hub-link/README.md)
- [Device-link](../../plugins/device-link/README.md)
- [Managed-config](../../plugins/managed-config/README.md)
- [Intent-scanner](../../plugins/intent-scanner/README.md)
- [Implementation status](../../docs/implementation-status.md#mobile)
