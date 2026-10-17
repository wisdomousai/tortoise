---
name: add-scanner-input
description: Add or change barcode scanner input at a point of work, so a scan submits the same catalog command a button or tool call would. Use when adding a scanner source or transport (wedge, serial, HID POS, camera, Android broadcast intent), a scanner profile or scan route, per-station device configuration, a rugged Android vendor profile, or a glove-sized operator input part. Covers packages/devices, plugins/intent-scanner, packages/operator-ui and docs/point-of-work-input.md.
---

# Add scanner input

A scan is input data under the person's authority, never authority itself. A route turns it into an ordinary command that policy still authorizes, with no model turn. [Point-of-work input](../../../../docs/point-of-work-input.md) holds the design rules and the scanner kit reference, and the [package README](../../README.md) lists the sources, profiles and entrypoints.

## Before writing

- Check whether the scanner fits an existing source: `createWedgeSource`, `createSerialSource`, `createHidPosSource`, `createCameraSource`, or `createIntentSource` from `plugins/intent-scanner` for rugged Android devices. Most scanners are keyboard wedges.
- Decide whether the change is data or code. A new scanner model, prefix, layout or route is a profile or route stored per station through the configuration module, not new code.
- Vendor programming barcodes come from vendor data supplied with the deployment, never from hard-coded values.

## Steps

1. **Profile.** Describe the scanner with `ScannerProfile` (`packages/devices/src/scanner/profile.ts`): transport, prefix, suffix, terminator, key gap, minimum length, AIM identifiers, GS1 separator substitute and emulated keyboard layout. Calibration (`calibrate`) suggests one from a single scan of the calibration barcode.
2. **Route.** Map scans to intents with `createScanRouter`: match a GS1 application identifier or a regular expression, optionally limited to symbologies; the first match wins.
3. **Store per station.** Compose `deviceConfigModule` from `@agent-native/devices/contracts` in the manifest and `createDeviceHandlers` in the application (`examples/line-station/manifest.ts`, `examples/line-station/application.ts`). The application passes an access view to `devicePolicy` to decide who administers devices.
4. **Declare non-wedge sources** with `scannerDevicesComponent` so the security manifest lists serial, HID and camera access. Web Serial, WebHID and camera access start from a user gesture.
5. **A new transport** is a `ScannerSource` that decodes through `decodeScan`, so prefixes, AIM identifiers and GS1 parsing follow the profile. Keep `packages/devices/src/scanner` portable: no Node or Bun imports, because it also runs in React Native.
6. **Rugged Android.** Compose `plugins/intent-scanner` and give the profile `transport: 'intent'` with the action, the data extra and a sender permission where injected scans matter. The [intent-scanner README](../../../../plugins/intent-scanner/README.md) has Zebra and Honeywell profiles; `examples/asset-survey-field` uses one.
7. **Screen parts.** Use `scan-prompt`, `scanner-setup` and the `use-scanner` hook from the operator registry and the capture hooks from `@agent-native/react/capture` (the `build-screens` skill, `packages/frame/skills/build-screens/SKILL.md`). A scanner's keystroke burst, including its final Enter, must never fire a hotkey.

## Checks

```sh
bun test packages/devices
bun test plugins/intent-scanner
bun run check:boundaries
bun run check:registry:operator
```

Without hardware, an Android emulator or device stands in for the scanner app:

```sh
adb shell am broadcast -a dev.agentnative.SCAN --es com.symbol.datawedge.data_string 4006381333931
```

No physical scanner has been checked yet. A scanner type counts as supported only once it has run on the device and the [implementation status](../../../../docs/implementation-status.md#operator-workstation-bridge) records it; report deterministic, browser and device evidence separately.
