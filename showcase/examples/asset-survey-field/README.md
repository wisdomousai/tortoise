# Asset survey on a phone

The field application receives assignments from the [asset survey hub](../asset-survey/README.md) into a local [worklist](../../../docs/primitives.md#worklist). A worker can open the assigned site structure, photograph equipment and save captures while offline. On reconnection, the device sends the reports and photos to the hub, which makes its own acceptance decision.

The application has a local workspace and shares only the hub's browser-safe survey contracts. Device pairing and report acceptance remain decisions of the hub.

## Prepare a device build

The framework repository's `app.config.json` selects the field-service desktop application by default. From the repository root, select the field application for mobile and prepare its native entry:

```sh
export AGENT_NATIVE_MOBILE_APPLICATION=@agent-native/asset-survey-field
bun run mobile:prepare
bun run mobile:prebuild
bun run dev:mobile
```

Build and install a development client using the platform instructions in [`apps/mobile`](../../../apps/mobile/README.md); Metro alone is not an installed app. Set up a hub and pair the device before receiving work. The native screens, camera, scanner, managed configuration and pairing have not been checked on a device in the recorded evidence.

To export this application with its hub, run `bun run scaffold <absent-target> --name field-survey --example asset-survey-field`. In that export, set `application` in `app.config.json` to `@agent-native/asset-survey` and `targets.mobile.application` to `@agent-native/asset-survey-field` before starting the hub and preparing the phone. The export otherwise selects the field application for the desktop host, which has no web screens.

## Receiving and reporting work

1. The manager sends a survey to a paired device. The hub's assignment feed returns that device's open surveys and their briefs; the field app shows the site tree and creates a notice for a new assignment.
2. The worker selects a node, takes photos, adds a condition and note, and holds **Save**. The device commits the report, photo references and a delivery effect locally, even when the hub is unreachable.
3. On reconnection, the peer connector uploads attached photos and sends each report with a stable effect ID. The hub authorizes the device against the assignment and records the report or returns a refusal. The Sync screen shows the outcome and any refusal reason.
4. Marking a survey done queues a separate effect and stops new captures on the device. The feed later removes the completed survey. A refused done mark reopens it.

In the foreground the device polls every five seconds. An unreachable hub or refused credential leaves an effect pending for retry; an idempotency conflict is held. A contract-digest mismatch also leaves delivery pending until the applications are compatible.

## Scanner and OS actions

The [scanner profile](../../../docs/glossary.md#scanner-profile) in [`ui-native/shared.tsx`](ui-native/shared.tsx) is Zebra DataWedge broadcasting `dev.agentnative.SCAN`. Change it to match the device's scanner software. The profile is a constant, not a setting.

The field app can open an asset tag sent by another Android application, share a capture summary and start a work request in the example maintenance app. An incoming intent can open a screen but does not commit a capture. The notification for a new survey may show its title on the lock screen.

## Version 1 workspaces

The state is at version 2. A workspace written by version 1 is upgraded when it is first read. It starts with an empty worklist, and the next feed brings back the surveys still open for the device. The captures the hub took are at the hub. The step refuses a workspace with a capture or a return still waiting for the hub; deliver it with version 1 first. Hub-link keeps the pairing, so the device is not paired again.

## Trust boundary

The device has one person, its owner, who may call every field capability. The [integration principal](../../../docs/glossary.md#integration-principal) completes `hub` outcomes and applies the hub's feed, and nothing else.

The hub decides again on every report and done mark, as `device:<id>` and within the [device link](../../../docs/glossary.md#device-link) grant. The hub's assignment feature takes them only for surveys sent to that device. Nothing on the device widens what the hub accepts. The feed is the only source of surveys, and the device never edits them.

The device does not check a capture's node against the survey. The hub stores a capture on a node the survey does not cover without its node, and a reviewer links it.

Hub-link holds the device credential in the platform's secret store (Keystore or Keychain). The photos are stored as blobs in the application's sandbox and stay after delivery. Managed configuration is trusted as the fleet administrator's.

A scan is input under the owner's instance, like typing. It only searches and opens a screen.

An intent from another app comes from an unauthenticated sender on the device. The shell port accepts only the declared action with a `tag` extra of at most 128 characters without spaces or colons, and drops any other extra. The tag then only opens a screen; nothing commits until the person holds the save button.

The work request is an explicit intent: only `com.example.maintenance` receives it, with only the declared extras, and the person presses the button for each. The share sheet receives text the person chose to share. The notice shows the survey title on the lock screen, which the action declares as the `assignment-title` data class. The notifications dispatcher completes a notice as the owner under its delegated grant; no screen can.

## Limits

- **Fixed captures.** The device cannot amend, link or discard a capture, because the effect payload is fixed when it is enqueued. Linking happens on the hub during review.
- **Refused captures.** A capture the hub refuses stays on the device with the hub's reason. No capability sends it again.
- **Scanner profile.** The profile is a constant in `ui-native/shared.tsx`. Another scanner app needs a code change and a new build.
- **Scan match.** A scan opens the Capture screen only when it matches exactly one node. Otherwise it only fills the search field.
- **Brief photos.** A survey's brief includes no photos or documents, because the feed pull downloads no blobs.
- **Delivery order.** The dispatcher continues past an effect that is in backoff or whose delivery just failed. A done mark can then reach the hub before an earlier capture, which the hub still accepts.
- **Device storage.** Delivered captures and their photo blobs stay on the device. No capability removes them.
- **Foreground delivery.** Delivery and sync loops run only while the application is in the foreground. In the background the OS decides when one bounded pass runs, and iOS runs it rarely.
- **Check in an export.** A previous single-example export check found that the skills check reports paths into omitted examples and changed root scripts, and `check:boundaries` fails while `apps/mobile/generated/` exists. The full `bun test` also failed because compliance controls named evidence tests in the omitted examples. The former `check:readmes` has since been removed.
- **Owner only.** Anyone who unlocks the device acts as its owner. The device has no per-person identity.
- **Device runs.** The native screens, camera, scanner, managed configuration and pairing have not run on a device.

## Code and checks

[`contracts.ts`](contracts.ts) declares the worklist and hub target; [`field-application.ts`](field-application.ts) connects the peer; `ui-native/` contains the assignment, capture and sync screens.

```sh
bun test showcase/examples/asset-survey-field
bun run typecheck
```

`test/pipeline.test.ts` runs the hub on loopback and the field application on Bun mobile bindings, including offline captures and later delivery. Those tests do not prove the native device experience. Preparing the mobile entry creates `apps/mobile/generated/`; the current boundary check reports that generated directory if it remains present.
