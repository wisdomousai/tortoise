# @agent-native/devices

This package turns point-of-work device input into commands. A keyboard-wedge, serial, HID POS or camera scanner produces a normalized scan. A configured route turns the scan into the same command a button or tool call would submit, with no model turn, so a scanner is one more [caller](../../docs/glossary.md#caller).

## Layer

Framework (`packages/*`). Scanner logic and the capability [module](../../docs/glossary.md#module) are browser-safe, and handlers and policy are server-only. The package treats every scan as untrusted input.

## Primitives

- [Input source](../../docs/primitives.md#input-source): `ScannerSource`, `ScanEvent`, `decodeScan`, `calibrate`, `createScanRouter`, `createWedgeSource`, `createSerialSource`, `createHidPosSource`, `createCameraSource`, `scannerDevicesComponent`.
- [Scanner profile](../../docs/primitives.md#station-and-scanner-profiles): `ScannerProfile`, `scannerProfileSchema`, `ScanRoute`.
- [Device configuration module](../../docs/primitives.md#device-configuration-module): `deviceConfigModule`, `createDeviceHandlers`. A supervisor's screen, a CLI script and an agent change scanner profiles and routes through it the same way, under policy and revisions.

The setup screen and the scanner hook ship in [`@agent-native/operator-ui`](../operator-ui/README.md).

A [scanner profile](../../docs/glossary.md#scanner-profile)'s `transport` may be `intent`, with `intent: { action, dataExtra, senderPermission? }`. A rugged Android device's scanner application then broadcasts each scan. This package only describes that transport. The receiver and its source ship in [`@agent-native/intent-scanner`](../../plugins/intent-scanner/README.md).

These modules are portable and run in React Native as well: `scanner/decode`, `scanner/profile`, `scanner/source`, `scanner/gs1`, `scanner/symbology` and `scanner/layouts`. `check:boundaries` keeps Node and Bun out of them.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/devices` | browser and server | Every scanner module: sources, decoding, GS1, AIM symbologies, keyboard layouts, calibration, profiles and routing. |
| `@agent-native/devices/*` | per row | One source file, for example `@agent-native/devices/scanner/wedge`. |
| `@agent-native/devices/contracts` | browser and server | `deviceConfigModule` and `deviceOperations`. |
| `@agent-native/devices/requirements` | browser and server | `scannerDevicesComponent`: serial, HID and camera sources as device requirements. |
| `@agent-native/devices/server` | server only | `createDeviceHandlers`, `createDeviceState`, `devicePolicy`, `deviceAuthorizationRoute`. |

`deviceOperations` holds `device.config.get`, `device.scanner.save`, `device.scanner.remove` and `device.routes.save`.

## Trust boundary

### Scan input

A scan is input data and grants no permission. Sources are registered explicitly, and nothing is discovered. Web Serial, WebHID and camera access start inside `start`, which must run from a gesture by the person at the screen. Vendor SDKs stay in the host process behind `HostScannerBridge`. The renderer receives decoded text only, and the preload bridge never exposes the SDK.

### Configuration

The configuration module is domain-neutral. The composing application decides who reads or administers a station by passing an access view to the device policy. Routes are compiled before they are stored, and stale writers conflict on the expected revision. Profiles are configuration and hold no secrets.

### Device requirements

Each non-wedge source is declared as a device requirement, so the security manifest lists it. Device access is declared, and the host does not mediate it. No source has been checked on real hardware. The intent transport is not declared as a device requirement: on Android the scanner application is a separate application, and the host opens no device for it.

## Dependencies

Framework: `@agent-native/contracts`, and `@agent-native/runtime` in `server` only. External: `zod`. `bun run check:boundaries` keeps `@agent-native/devices/server` out of browser code.

## Tests

```sh
bun test packages/devices
```

- `test/scanner.test.ts`: layout repair for a US scanner on QWERTZ or Swiss hosts with dead keys, GS1 check digits and fields, AIM identifiers and calibration inference. It also covers routing, serial line assembly, HID POS reports, camera repeat suppression, wedge bursts and the host bridge.
- `test/config.test.ts`: administrators configure, operators read and people with no role see nothing; stale route writers conflict.

## Skills

- [add-scanner-input](skills/add-scanner-input/SKILL.md): add a scanner source, profile, route or rugged Android vendor profile.

## References

- [Point-of-work input](../../docs/point-of-work-input.md)
