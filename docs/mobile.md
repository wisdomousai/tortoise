# Mobile host

The mobile host runs an application inside the native app process and keeps its workspace in the device sandbox. Native screens call the instance through a direct transport. Device pairing is supplied by the relevant host plugins when the application composes them.

## Packages

The Expo project in `apps/mobile` receives its selected application from `app.config.json`. `mobile:prepare` writes the generated entry that imports its plugins and screens. The starter does not name application content.

The [mobile package](../packages/mobile/README.md) supplies the platform and instance lifecycle. The [native frame](../packages/frame-native/README.md) renders native screen contributions. The [device-link](../plugins/device-link/README.md) and [hub-link](../plugins/hub-link/README.md) plugins implement enrollment from their respective sides.

## Host platform and storage

Mobile uses the shared composition kernel and transactional runtime. A declared requirement unsupported by the platform refuses startup. The platform provides no raw socket or child-process facility and has no inbound listener.

A workspace identifier is a name within the sandbox. It cannot select a path outside that sandbox. Snapshot storage keeps one JSON document in `<name>.workspace.sqlite`. Blobs live under `tortoise/<name>/blobs` in the document directory. An exclusive transaction on `<name>.lock.sqlite` owns the workspace while open and refuses a competing open.

Native secrets use the platform Keychain or Keystore. Host plugins with native code must have their Expo module included in the build.

## Instance lifecycle

`openMobileInstance` opens the application as the device's local user. Its direct transport has no network session. The opened instance can execute local commands while offline.

The lifecycle starts delivery workers and observers when the app enters the foreground. Entering the background stops them. Each foreground transition starts the plugin observers again. Closing stops the instance and releases workspace ownership.

`backgroundPass` drains delivery with a default 20-second timeout, then runs inbound sync. The drain timeout does not bound the subsequent sync. The OS can stop background execution before that work completes, leaving undelivered effects queued for a later pass.

The screen tree and background task share the instance through `apps/mobile/src/app.tsx`. A second instance cannot open the same workspace. The OS may start the runtime solely for the background task. Its configured minimum interval defaults to 15 minutes, and actual scheduling remains an OS decision. On iOS, applications must allow for delivery occurring only while foregrounded. An offline delivery destination uses `offline: 'queue'`.

## Embedded and attached modes

An embedded application keeps its own device workspace. Hub delivery uses a peer connector over the hub-link network port. Inbound sync applies hub records through local commands. The hub authorizes received work under the paired device's identity. Its acceptance remains a separate command at the hub.

An attached tablet opens the paired hub's web build in a restricted WebView through the hub-link screen. It receives the hub's current web interface. A narrow layout needs the hub screen's declared `compact` variant.

## Pairing

The hub issues a one-use enrollment code through `link.enrollment.create`. A person enters that code on the pairing screen, or managed configuration supplies `hub-url` and `enrollment-code`. The device exchanges it for a credential at the enrollment endpoint.

The hub stores the credential digest and resolves it on every request. Revocation therefore refuses the device's next request. A `field-sync` credential acts as `device:<id>` within application-granted capabilities. An `attached` credential acts as the enrolling person with the capability scope chosen at enrollment.

LAN enrollment requires the hub's TLS configuration under a profile that permits it. The device must trust the issuing CA; device management installs that trust. Development emulators can reach a loopback hub through `adb reverse`.

## Trust boundary

The unlocked device's holder is its local user. Application-level isolation depends on the native app sandbox. Pairing credentials remain in secure storage and are excluded from device-to-device backup transfer.

The plugin supplying the mobile network port controls use of platform fetch. Hub-link confines requests to the paired origin and refuses redirects. Mobile does not provide the desktop network guard or exported firewall enforcement.

The attached WebView loads only the hub origin and blocks new windows. It has no script bridge or file access. It receives a one-use launch key that creates its own private session; the device credential does not enter the WebView.

A missing native module for a composed plugin refuses startup. Manifest validation also rejects a plugin on an unsupported platform.

## Build and checks

From the repository root, generate the entry before preparing the native project:

```sh
bun run mobile:prepare
bun run mobile:prebuild
bun run dev:mobile
```

The repository checks validate portable-source boundaries and native types. Platform tests exercise SQLite and file behavior under Bun. `test:portable` removes Web globals absent from Hermes when running the portable suites. These checks do not establish device OS lifecycle behavior.

`bun run check:mobile-bundle` bundles the starter fixture with Metro. Device and simulator execution requires a separate run. Current evidence is recorded in [Implementation status](implementation-status.md#mobile). The [mobile-host skill](../packages/mobile/skills/extend-mobile-host/SKILL.md) describes application setup.
