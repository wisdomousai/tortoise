# Point-of-work input

Operator screens are used with gloves, at arm's length or further, while the person watches the machine. Scanners and keypads do most of the input. This guide specifies the two reusable kits for those screens:

- **`packages/devices`**: device logic. It covers scanner profiles, sources, decoding, calibration and routing, plus a reusable capability module for per-station device configuration.
- **`packages/operator-ui`**: the thick-finger UI kit, a shadcn registry composed from stock shadcn primitives.

Both are domain-neutral. `examples/line-station` and the quality-inspection capture station consume them; any composed application can do the same. The architecture they serve is described in the [operator workstation pattern](operator-workstation-pattern.md).

## Interaction rules

These rules apply to every screen built from the kit:

1. **No precision gestures.** Avoid drag, double-tap, long text entry, small close buttons, hover-only affordances and swipe-to-act. Every target meets `--operator-target` (64 px default, 80 px at glove density), with at least `--operator-gap` between targets.
2. **Scanner and keypad first.** Every task can be completed with a scanner, a numeric keypad or a foot pedal mapped to keys. Touch is the fallback, and typing on a keyboard is the last resort (manual entry behind a scan prompt).
3. **One task at a time.** The surface shows who and where at the top, then station signals, then the current task, then what needs a person, then seat control. Nothing in that order moves while a person is reaching for it.
4. **Consequential actions need hold-to-confirm.** A tap never starts an order, confirms counts or reports that a held procedure took effect. Holds cancel when the finger slides off. A tap guard suppresses double taps, taps during scroll or layout shift, and taps while a request is pending.
5. **State is icon plus text, readable at 1–2 m.** Color is never the only signal. Upstream delivery shows `Pending`, `Retrying`, `Held`, `Accepted` (with the upstream reference) or `Rejected` (with the code). Observed values show their age and confidence.
6. **Audible feedback.** Distinct tones play for scanned, accepted, rejected and attention. Vibration is used where available. Feedback can be muted per device.
7. **Digit keys belong to one control.** On a screen that uses digit hotkeys for tiles, the numeric pad is tapped (`keyboard={false}`). Keystroke bursts from a keyboard-wedge scanner never fire hotkeys, including the scan's terminating Enter.

## Operator UI registry

`packages/operator-ui` is a shadcn registry named `operator`. Its items declare stock shadcn primitives as `registryDependencies` and add glove sizing through `cva` variants and theme tokens. No shadcn primitive is forked.

| Item                                                                                                                                | Type      | Purpose                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `operator-theme`                                                                                                                    | theme     | Target, gap and text tokens; `[data-density=glove]` and high-contrast scopes; `op-ok`, `op-pending`, `op-attention`, `op-fault` states. |
| `use-press-and-hold`, `use-tap-guard`, `use-feedback`, `use-idle-return`, `use-operator-keys`, `use-scanner`                        | hook      | Hold-to-confirm, tap suppression, tones, idle return, keypad/pedal bindings with a scan-burst filter, scanner sources and routes.       |
| `numeric-entry`                                                                                                                     | lib       | Decimal parsing with comma or period, decimals and tolerance verdicts.                                                                  |
| `operator-surface`, `big-action`, `tile-picker`, `numeric-pad`, `scan-prompt`, `status-strip`, `attention-queue`, `takeover-button` | component | The primitives of a station screen.                                                                                                     |
| `scanner-setup`, `operator-station`                                                                                                 | block     | Scanner calibration, profile and live test; the station layout skeleton.                                                                |

`bun run build:registry:operator` generates `registry.json` and `src/styles/operator.css` from `registry.manifest.ts`, then runs `shadcn build` into `dist/registry/operator`. The generator fails when an item imports an `@/` module it does not declare as a registry dependency, or a package it does not declare as a dependency. `check:registry:operator` (part of `bun run check`) fails when the generated files drift.

Inside this repository, `apps/web` resolves `@/` against its own sources first and then against `packages/operator-ui/src` (see `apps/web/vite.config.ts`). The app therefore uses the registry items in place, with the same import paths a pulling app would have after `shadcn add`. Another application pulls them from the built registry with the shadcn CLI.

`use-scanner` and `scanner-setup` depend on `@agent-native/devices`, which is not published. They can be pulled outside this workspace only once that package is published or vendored. A scratch-app `shadcn add` acceptance test is not yet part of the gates.

The gallery at `#/station/kit` renders every primitive at desk, touch and glove density with local state only. `tests/e2e/station.pw.ts` uses it for interaction tests: a hold that cancels on slide-off, digit hotkeys and paging, a wedge burst that fires no hotkey, keypad tolerance and the takeover hold.

## Scanner device kit

### Profiles

A `ScannerProfile` describes one scanner as the station sees it:

- the transport: `wedge`, `serial`, `hid-pos`, `camera` or `host-plugin`;
- the prefix and suffix it adds, and its terminator;
- the maximum inter-key gap (wedge only);
- the minimum length;
- whether AIM symbology identifiers are enabled;
- the group-separator substitute for GS1;
- the keyboard layout the scanner emulates.

Profiles are configuration, not secrets. They are stored per station through the device configuration module.

### Sources

Each transport is a `ScannerSource` with explicit registration. Nothing is discovered silently.

| Source      | Browser API                               | Notes                                                                                                                              |
| ----------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Wedge       | Keyboard events                           | Works with any USB-HID keyboard-emulating scanner, the cheapest and most common kind. Bursts are told apart from typing by timing. |
| Serial      | Web Serial                                | USB-COM/CDC and RS-232 adapters; a line assembler handles the terminator.                                                          |
| HID POS     | WebHID, usage page `0x8C`                 | Barcode-scanner usage page; reports are reassembled.                                                                               |
| Camera      | `BarcodeDetector`, or an injected decoder | Repeats are filtered; the decoder is injectable where `BarcodeDetector` is unavailable.                                            |
| Host plugin | Host bridge (`HostScannerBridge`)         | For vendor SDKs on the station PC. Only a fake bridge exists in this reference.                                                    |

Browsers require a user gesture to connect serial, HID and camera sources. The setup block offers a connect button for them.

### Decoding

`decode` turns raw scanner output into a `ScanEvent`. It strips the prefix and suffix, then parses AIM identifiers (`]C1`, `]d2`, `]Q3`, `]E0` and others) into a symbology. It then parses GS1 element strings and validates check digits where the AI defines one (00, 01, 10, 17, 21, 30, 310x and more). For wedge input it also corrects keyboard-layout mismatches.

Layout mismatch is the most common wedge failure. A scanner emulating a US keyboard on a German or Swiss host types `z` for `y`, and also swaps punctuation. Dead keys can swallow the next character. The GS1 group separator (ASCII 29) is often dropped or sent as a substitute. Supported host layouts are `us`, `de` and `de-ch`.

### Calibration

The setup block renders a Code 128 calibration symbol, `CALIBRATION_CODE`. It holds the characters that break most often (`y`/`z`, shifted punctuation, a group separator) between start and end markers. `calibrate` takes one recorded scan and infers several settings from it:

- the terminator and inter-key timing;
- any prefix or suffix, and whether AIM identifiers are present;
- the layout mismatch and the group-separator substitute.

It returns a suggested profile and reports problems that no setting can fix. This approach is vendor-agnostic and works with cheap wedge scanners that come without configuration software. Rendering vendor programming barcodes (scanner-side setup codes) is not part of this reference. Those codes must come from deployment-supplied vendor data, never from hard-coded values.

### Routing

A scan router maps scans to intents with no model turn. Routes match a GS1 AI or a regular expression, optionally restricted to symbologies. The first match wins; a capture group, if present, becomes the routed value. Sites store their routes with the device configuration. The line-station surface falls back to `^(ORD-\d{4,})$` for orders.

### Device configuration module

`deviceConfigModule` (`@agent-native/devices/contracts` and `/server`) is a reusable capability module with four operations: `device.config.get`, `device.scanner.save`, `device.scanner.remove` and `device.routes.save`. It is composed like a feature module. The composing application supplies the access view. In the starter, station supervisors administer device configuration and every other station role reads it. Writes take `expectedRevisions` on `device:<station>`.

## Evidence

Deterministic tests cover decoding, GS1 check digits, AIM parsing, layout remapping, calibration inference, serial and HID report assembly, camera repeat filtering, routing and the device module's policy (`bun test packages/devices packages/operator-ui`). Browser tests cover the kit interactions and the bound station surface (`tests/e2e/station.pw.ts`).

None of the physical scanner types (wedge, serial, HID POS, camera) has been checked on real hardware yet. Electron permission handlers for Web Serial and WebHID are not wired yet. Until a device has been checked and the result recorded in the [implementation ledger](implementation-status.md#operator-workstation-bridge), do not claim it is supported.
