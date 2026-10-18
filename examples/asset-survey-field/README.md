# @agent-native/asset-survey-field

`asset-survey-field` is the field application of the [asset survey](../asset-survey/README.md). It runs on a phone or rugged handheld with its own workspace in [embedded mode](../../docs/glossary.md#embedded-mode), and receives the assignments the [hub](../../docs/glossary.md#hub) dispatched to it with their structure. Offline, it photographs nameplates and equipment, and it hands the captures back when it reaches the hub again.

The example demonstrates the [mobile host](../../docs/mobile.md) and delivery to a peer host as a [system of record](../../docs/systems-of-record.md).

## Layer

Content (`examples/*`). It reuses the hub's browser-safe contracts (`@agent-native/asset-survey/contracts/*`) for the capture input and the feed item, so both sides validate the same records. It never imports the hub's server code.

## Primitives

The example is one [application](../../docs/primitives.md#application), targeting `mobile`. It composes:

- one [module](../../docs/primitives.md#module), `survey-field` in [`contracts.ts`](contracts.ts), with capabilities that:
  - list assignments;
  - browse and search an assignment's nodes;
  - record a capture;
  - list captures;
  - return an assignment.
- a [target](../../docs/primitives.md#target), `hub`, wired with `connectTarget` over the peer [connector](../../docs/primitives.md#connector) `createPeerPort`. It works in two directions:
  - captures and returns go out through the [outbox](../../docs/glossary.md#outbox) to the hub's own `capture.ingest` and `assignment.return`;
  - the hub's `assignment.feed` comes back through [inbound sync](../../docs/glossary.md#inbound-sync).
- [blob references](../../docs/primitives.md#blob-store): photos are stored on the device when taken. `field.capture.record` attaches them, so the peer connector uploads them before the record.
- three [host plugins](../../docs/primitives.md#host-plugin):
  - `hub-link` pairs the device and is its network port;
  - `managed-config` turns device-management values (`hub-url`, `enrollment-code`) into settings, so a managed device pairs on first start;
  - `intent-scanner`, on Android, takes scans from the device's imager.
- [native screens](../../docs/primitives.md#native-frame) with [capability bindings](../../docs/primitives.md#capability-binding):
  - Assignments;
  - an assignment's tree, with designation search, where a scanned tag that matches one node opens its capture;
  - Capture: camera, kind and condition chips, a note, and hold to save;
  - Unplaced captures;
  - Sync, with each capture's state at the hub and the hub's reason for a refusal.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/asset-survey-field/manifest` | any host | Default export: the manifest with every plugin any build composes, which `mobile:prepare` reads. |
| `@agent-native/asset-survey-field/field-application` | any host | `createFieldApplication({ plugins?, fetch?, services? })`: hub-link plus the given plugins. |
| `@agent-native/asset-survey-field/application` | React Native (Hermes) | Default export: the device build, which adds managed-config and, on Android, the intent scanner. |
| `@agent-native/asset-survey-field/screens-native` | React Native (Hermes) | Default export: `defineNativeScreens` with the field screens and the plugin screens. |
| `@agent-native/asset-survey-field/*` | see file | `contracts`, `domain`, `handlers`, `policy`, and `ui-native/*` (React Native). |

`fieldManifest(plugins)` builds the manifest of one build. Tests compose `createFieldApplication` under Bun without the native plugins. The native screens are Assignments (home), Assignment, Capture, Unplaced and Sync. The plugin screens are hub-link's and, on Android, the scanner's.

### Capture flow

1. The hub dispatches an assignment to the paired device. The next inbound sync applies the hub's feed: every assignment of this device, with the nodes below its roots.
2. `field.capture.record` checks that the assignment is open and that the node belongs to it. A capture with no node is unplaced.
3. `field.capture.record` then attaches the photos and enqueues `capture.ingest` to `hub` with the capture as the payload. The capture ID is generated on the device, so a capture delivered twice is the same capture at the hub.
4. `field.assignment.return` enqueues `assignment.return` after the captures already waiting, and closes the assignment for further captures.
5. The outbox delivers when the hub is reachable, uploading the photos first. The hub's outcome settles each record as `accepted`, or as `rejected` with the hub's code and message. A refused return reopens the assignment on the device. An unreachable hub or a refused device credential leaves the record pending.
6. Once the hub has the return, its feed marks the assignment `returned` on the device.

Captures cannot be amended, placed or discarded on the device. The outbox payload is fixed once enqueued, so placing happens on the hub during review.

### Scanner profile

The [scanner profile](../../docs/glossary.md#scanner-profile) in [`ui-native/shared.tsx`](ui-native/shared.tsx) is Zebra DataWedge broadcasting `dev.agentnative.SCAN`. Change it to match the device's scanner software. The [intent-scanner README](../../plugins/intent-scanner/README.md) has the Honeywell variant. The profile is a constant, not a setting.

### Device run

1. Set `targets.mobile.application` in `app.config.json` to `@agent-native/asset-survey-field`, or set `AGENT_NATIVE_MOBILE_APPLICATION` for one build.
2. Run `bun run mobile:prepare`.
3. Run the mobile build scripts in [`apps/mobile`](../../apps/mobile/README.md).

The [implementation status](../../docs/implementation-status.md) records which device runs have not been done.

## Trust boundary

The device has one person, its owner, who may call every field capability. The [integration principal](../../docs/glossary.md#integration-principal) settles `hub` outcomes and applies the hub's feed, and nothing else.

The hub decides again on every record, as `device:<id>` and within the [device link](../../docs/glossary.md#device-link) grant. Nothing on the device widens what the hub accepts. The feed is the only source of assignments, and the device never edits them.

Hub-link holds the device credential in the platform's secret store (Keystore or Keychain). The photos are stored as blobs in the application's sandbox and stay after delivery. Managed configuration is trusted as the fleet administrator's.

A scan is input under the owner's authority, like typing. It only searches and opens a screen.

## Dependencies

- Framework:
  - `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/integration`;
  - `@agent-native/kernel`;
  - `@agent-native/frame-native`;
  - `@agent-native/devices` (scanner types).
- Plugins: `@agent-native/hub-link`, `@agent-native/managed-config`, `@agent-native/intent-scanner`.
- Content: `@agent-native/asset-survey` (browser-safe contracts and domain types).
- Expo config plugin: the manifest's `expoPlugins` lists `expo-camera` with the camera permission text and no microphone. The capture screen takes stills only.
- External, React Native only:
  - `react-native`, `expo-camera`, `expo-file-system`;
  - `@react-navigation/native`, `@tanstack/react-query`, `lucide-react-native`.

## Tests

```sh
bun test examples/asset-survey-field
bun run typecheck
```

`test/pipeline.test.ts` runs the hub on loopback (`startHost`). It runs the field application on the mobile platform with Bun's SQLite and files (`openMobileAuthority`).

- The first test runs the full survey:
  1. The phone pairs from managed configuration.
  2. It receives the dispatched assignment and its structure, and finds a node by tag.
  3. Offline, it records a placed and an unplaced capture and returns the assignment. A later capture is refused.
  4. On reconnecting, it delivers all three, photos included. Delivering again changes nothing at the hub.
  5. The hub's feed closes the assignment on the phone.
  6. At the hub, the nameplate is read, accepted and filed into the demo EAM with the photo as evidence.
- The second test covers refusals with two phones:
  - a node outside an assignment is refused on the phone;
  - a capture the hub refuses (`CONFLICT`) is shown as rejected with the hub's code.

`test/ui-bindings.test.ts` checks that a native screen references every field capability that claims a UI binding.

`tsconfig.native.json` type-checks the native screens; the tests do not render them. To check that Metro bundles them:

```sh
AGENT_NATIVE_MOBILE_APPLICATION=@agent-native/asset-survey-field bun run mobile:prepare
cd apps/mobile
expo export --platform android
```

The camera, scanner and managed-configuration paths need a device.

## Skills

- [extend-mobile-host](../../packages/mobile/skills/extend-mobile-host/SKILL.md) covers the mobile host, its plugins and pairing.
- [add-scanner-input](../../packages/devices/skills/add-scanner-input/SKILL.md) covers the scanner profile and the intent scanner.
- [connect-system-of-record](../../packages/integration/skills/connect-system-of-record/SKILL.md) covers the `hub` target.
