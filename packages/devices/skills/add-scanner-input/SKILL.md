---
name: add-scanner-input
description: Add or change barcode scanner input at a point of work, so a scan submits the same catalog command a button or tool call would. Use when adding a scanner source or transport (wedge, serial, HID POS, camera, Android broadcast intent), a scanner profile or scan route, per-station device configuration, a rugged Android vendor profile, or a glove-sized operator input part. Covers packages/devices, plugins/intent-scanner, packages/operator-ui and docs/point-of-work-input.md.
---

# Add scanner input

A scan is input data from the person who scans, and it grants nothing by itself. A scan route turns it into an ordinary command that policy still authorizes, with no model turn.

## Before writing

- Check whether the scanner fits an existing input source: `createWedgeSource`, `createSerialSource`, `createHidPosSource` or `createCameraSource`. For rugged Android devices, use `createIntentSource` from `plugins/intent-scanner`.
- Decide whether the change is data or code. A new scanner model, prefix, layout or route is a profile or route stored per station through the configuration module. It needs no new code.
- Take vendor programming barcodes from vendor data supplied with the deployment. Never hard-code them.

## Steps

1. Describe the scanner with a scanner profile, `ScannerProfile` in `packages/devices/src/scanner/profile.ts`. It holds the transport, prefix, suffix, terminator, key gap, minimum length, AIM identifiers, GS1 separator substitute and emulated keyboard layout.
2. To suggest a profile, run calibration (`calibrate`) on a single scan of the calibration barcode.
3. Map scans to intents with `createScanRouter`. A route matches a GS1 application identifier or a regular expression, optionally limited to symbologies. The first match wins.
4. List `deviceFeatureManifest` from `@tortoise/devices/contracts` in `defineManifest({ features })`.
5. Mount `deviceFeature()` from `@tortoise/devices/server` with `mountFeature`, with an access view whose `relation(context, station)` returns `administer`, `read` or nothing from the application's own station roles. It must refuse non-members and integration principals; `deviceAccess` in `showcase/examples/winding-line/policy.ts` is one. The `write-a-feature` skill (`packages/host/skills/write-a-feature/SKILL.md`) covers mounting and adopting existing configuration. The feature's commands bind to the `scanner-setup` screen, so the application's screens must register a screen with that binding, or the UI-binding test fails.
6. Remove any application policy rule for `device.*` operations and any event rule for `device`.
7. Declare each source other than the wedge with `scannerDevicesComponent`, so the security manifest lists serial, HID and camera access. Web Serial, WebHID and camera access start only from a person's click or key press, as browsers require.
8. Write a new transport as a `ScannerSource` that decodes through `decodeScan`. Prefixes, AIM identifiers and GS1 parsing then follow the profile.
9. Keep `packages/devices/src/scanner` portable, with no Node or Bun imports, because it also runs in React Native.
10. For rugged Android, compose `plugins/intent-scanner`. Give the profile `transport: 'intent'` with the action, the data extra, and a sender permission where injected scans matter.
11. Build the screen parts from the operator UI registry: `scan-prompt`, `scanner-setup` and the `use-scanner` hook. Add the capture hooks from `@tortoise/react/capture`. The `build-screens` skill (`packages/frame/skills/build-screens/SKILL.md`) covers both.
12. Make sure a scanner's keystroke burst, including its final Enter, never fires a hotkey or submits the focused form. Filter the burst with `KeyBurstFilter` from the operator registry's `use-operator-keys` hook before it reaches the form.
13. In a Playwright spec, type an upper-case scan with Shift held, because `keyboard.type` sends capitals without Shift and the wedge decoder reads the key events.

## Checks

1. Run the tests and checks:

   ```sh
   bun test packages/devices
   bun test plugins/intent-scanner
   bun run check:boundaries
   bun run check:registry:operator
   ```

2. Without hardware, let an Android emulator or device stand in for the scanner app:

   ```sh
   adb shell am broadcast -a dev.tortoise.SCAN --es com.symbol.datawedge.data_string 4006381333931
   ```

3. Report deterministic, browser and device evidence separately.

No physical scanner has been checked yet. A scanner type counts as supported only once it has run on the device and [implementation status](../../../../docs/implementation-status.md#operator-workstation-bridge) records it.

## References

- [Point-of-work input](../../../../docs/point-of-work-input.md)
- [`@tortoise/intent-scanner`](../../../../plugins/intent-scanner/README.md)
- [`showcase/examples/asset-survey-field`](../../../../showcase/examples/asset-survey-field/README.md)
