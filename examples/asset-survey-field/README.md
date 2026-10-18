# @agent-native/asset-survey-field

The field app of the [asset survey](../asset-survey/README.md). It runs on a phone or rugged handheld with its own workspace (embedded mode). It receives the assignments the hub dispatched to it, with each assignment's structure. Offline, it photographs nameplates and equipment, and it hands the captures back when it reaches the hub again.

Technical documentation: [`DOCUMENTATION.md`](DOCUMENTATION.md).

Layer: content (`examples/*`). It reuses the hub's browser-safe contracts (`@agent-native/asset-survey/contracts/*`) for the capture input and the feed item, so both sides validate the same records. It never imports the hub's server code.

## Primitives

This example is one [Application](../../docs/primitives.md#application), targeting `mobile`. It composes:

- one [module](../../docs/primitives.md#module), `survey-field` in [`contracts.ts`](contracts.ts):
  - list assignments;
  - browse and search an assignment's nodes;
  - record a capture;
  - list captures;
  - return an assignment.
- a [target](../../docs/primitives.md#target), `hub`, wired with `connectTarget` over the peer [connector](../../docs/primitives.md#connector) `createPeerPort`. It works in two directions:
  - captures and returns go out through the outbox to the hub's own `capture.ingest` and `assignment.return`;
  - the hub's `assignment.feed` comes back through inbound sync.
- [blob references](../../docs/primitives.md#blob-store): photos are stored on the device when taken. `field.capture.record` attaches them, so the peer connector uploads them before the record.
- three [host plugins](../../docs/primitives.md#host-plugin):
  - `hub-link` pairs the device and is its network port;
  - `managed-config` turns device-management values (`hub-url`, `enrollment-code`) into settings, so a managed device pairs on first start;
  - `intent-scanner`, on Android, takes scans from the device's imager.
- [native screens](../../docs/primitives.md#native-frame) with [capability bindings](../../docs/primitives.md#capability-binding):
  - Assignments;
  - an assignment's tree, with designation search; a scanned tag that matches one node opens its capture;
  - Capture: camera, kind and condition chips, a note, and hold to save;
  - Unplaced captures;
  - Sync, with each capture's state at the hub and the hub's reason for a refusal.

## Entrypoints

| Import                                                | Runs in               | Contents                                                                                                                                                       |
| ----------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@agent-native/asset-survey-field/manifest`           | any host              | Default export: the manifest with every plugin any build composes, which `mobile:prepare` reads. `fieldManifest(plugins)` builds one build's manifest.           |
| `@agent-native/asset-survey-field/field-application`  | any host              | `createFieldApplication({ plugins?, fetch?, services? })`: hub-link plus the given plugins. Tests compose it under Bun without the native plugins.              |
| `@agent-native/asset-survey-field/application`        | React Native (Hermes) | Default export: the device build. It adds managed-config, and on Android the intent scanner.                                                                  |
| `@agent-native/asset-survey-field/screens-native`     | React Native (Hermes) | Default export: `defineNativeScreens` with Assignments (home), Assignment, Capture, Unplaced and Sync, plus the hub-link and (Android) scanner plugin screens. |
| `@agent-native/asset-survey-field/*`                  | see file              | `contracts`, `domain`, `handlers`, `policy`, and `ui-native/*` (React Native).                                                                                        |

How a capture moves on the device:

1. The hub dispatches an assignment to the paired device. The next inbound sync applies the hub's feed: every assignment of this device, with the nodes below its roots.
2. `field.capture.record` checks two things: the assignment is open, and the node belongs to it (or there is none: unplaced). It then attaches the photos and enqueues `capture.ingest` to `hub` with the capture as the payload. The capture ID is generated on the device, so a capture delivered twice is the same capture at the hub.
3. `field.assignment.return` enqueues `assignment.return` after the captures already waiting, and closes the assignment for further captures.
4. The outbox delivers when the hub is reachable, uploading the photos first. The hub's outcome settles each record:
   - `accepted`;
   - `rejected`, with the hub's code and message. A refused return reopens the assignment on the device.

   An unreachable hub or a refused device credential leaves the record pending.
5. Once the hub has the return, its feed marks the assignment `returned` on the device.

The scanner profile in [`ui-native/shared.tsx`](ui-native/shared.tsx) is Zebra DataWedge broadcasting `dev.agentnative.SCAN`. Change it to match the device's scanner app; the [intent-scanner README](../../plugins/intent-scanner/README.md) has the Honeywell variant.

Run it on a device: set `targets.mobile.application` in `app.config.json` to `@agent-native/asset-survey-field` (or `AGENT_NATIVE_MOBILE_APPLICATION` for one build), then run `bun run mobile:prepare` and the mobile build scripts in [`apps/mobile`](../../apps/mobile/README.md).

Known limits:
- Captures cannot be amended, placed or discarded on the device. The outbox payload is fixed once enqueued, so placing happens on the hub during review.
- The scanner profile is a constant, not a setting.
- Device runs have not been done; see [implementation status](../../docs/implementation-status.md).

## Trust boundary

The device has one person, its owner, who may call every field operation. The integration principal settles `hub` outcomes and applies the hub's feed, and nothing else. The hub decides again on every record, as `device:<id>` and within the device-link grant. Nothing on the device widens what the hub accepts: the feed is the only source of assignments, and the device never edits them.

The device credential lives in the platform's secret store (Keystore or Keychain), held by hub-link. The photos are stored as blobs in the app's sandbox and stay after delivery. Managed configuration is trusted as the fleet administrator's.

A scan is input under the owner's authority, like typing: it only searches and opens a screen.

## Dependencies

- Framework:
  - `@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/integration`;
  - `@agent-native/kernel`;
  - `@agent-native/frame-native`;
  - `@agent-native/devices` (scanner types).
- Plugins: `@agent-native/hub-link`, `@agent-native/managed-config`, `@agent-native/intent-scanner`.
- Content: `@agent-native/asset-survey` (browser-safe contracts and domain types).
- Expo config plugin: the manifest's `expoPlugins` lists `expo-camera` with the camera permission text and no microphone, since the capture screen takes stills only.
- External, React Native only:
  - `react-native`, `expo-camera`, `expo-file-system`;
  - `@react-navigation/native`, `@tanstack/react-query`, `lucide-react-native`.

## Tests

```sh
bun test examples/asset-survey-field
bun run typecheck
```

`test/pipeline.test.ts` runs the hub on loopback (`startHost`) and the field app on the mobile platform with Bun's SQLite and files (`openMobileAuthority`).
- The first test runs the full survey:
  1. The phone pairs from managed configuration.
  2. It receives the dispatched assignment and its structure, and finds a node by tag.
  3. Offline, it records a placed and an unplaced capture and returns the assignment. A later capture is refused.
  4. On reconnecting, it delivers all three, photos included. Delivering again changes nothing at the hub.
  5. The hub's feed closes the assignment on the phone.
  6. At the hub, the nameplate is read and accepted and filed into the demo EAM with the photo as evidence.
- The second test covers refusals with two phones:
  - a node outside an assignment is refused on the phone;
  - a capture the hub refuses (`CONFLICT`) is shown as rejected with the hub's code.

`test/ui-bindings.test.ts` checks that a native screen references every field operation that claims a UI binding.

The native screens are type-checked by `tsconfig.native.json`, not rendered in tests. To check that Metro bundles them, run `AGENT_NATIVE_MOBILE_APPLICATION=@agent-native/asset-survey-field bun run mobile:prepare`, then `expo export --platform android` in `apps/mobile`. The camera, scanner and managed-configuration paths need a device.
