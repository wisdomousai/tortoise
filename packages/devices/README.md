# @agent-native/devices

Point-of-work device input. Scanners are callers too: a keyboard-wedge, serial, HID POS or camera scanner produces a normalized scan, and a configured route turns it into the same command a button or tool call would submit, with no model turn. The package also ships a reusable configuration module, so a supervisor's screen, a CLI script and an agent change scanner profiles and routes the same way, under policy and revisions.

Layer: framework (`packages/*`). Scanner logic and the capability module are browser-safe; handlers and policy are server-only.

## Primitives

- [Input source](../../docs/primitives.md#input-source): `ScannerSource`, `ScanEvent`, `decodeScan`, `calibrate`, `createScanRouter`, `createWedgeSource`, `createSerialSource`, `createHidPosSource`, `createCameraSource`, `scannerDevicesComponent`.
- [Profile](../../docs/primitives.md#profile): `ScannerProfile`, `scannerProfileSchema`, `ScanRoute`.
- [Configuration module](../../docs/primitives.md#configuration-module): `deviceConfigModule`, `createDeviceHandlers`.

[Point-of-work input](../../docs/point-of-work-input.md) explains wedge layouts, GS1 and calibration. The setup screen and scanner hook ship in [`@agent-native/operator-ui`](../operator-ui/README.md).

## Entrypoints

| Import                               | Runs in            | Contents                                                                                                                              |
| ------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `@agent-native/devices`              | browser and server | Every scanner module: sources, decoding, GS1, AIM symbologies, keyboard layouts, calibration, profiles and routing.                   |
| `@agent-native/devices/*`            | see below          | One source file, for example `@agent-native/devices/scanner/wedge`.                                                                   |
| `@agent-native/devices/contracts`    | browser and server | `deviceConfigModule`, `deviceOperations` (`device.config.get`, `device.scanner.save`, `device.scanner.remove`, `device.routes.save`). |
| `@agent-native/devices/requirements` | browser and server | `scannerDevicesComponent`: serial, HID and camera sources as device requirements.                                                     |
| `@agent-native/devices/server`       | server only        | `createDeviceHandlers`, `createDeviceState`, `devicePolicy`, `deviceAuthorizationRoute`.                                              |

## Trust boundary

A scan is input data, never authority. Sources are registered explicitly; nothing is discovered. Web Serial, WebHID and camera access start inside `start`, which must run from a user gesture. Vendor SDKs stay in the host process behind `HostScannerBridge`; the renderer receives decoded text only, and the SDK is never exposed through the preload bridge.

The configuration module is domain-neutral: the composing application decides who reads or administers a station by passing an access view to the device policy. Routes are compiled before they are stored, and stale writers conflict on the expected revision. Profiles are configuration, not secrets.

Each non-wedge source is declared as a device requirement, so the security manifest lists it. Gaps: no source has been checked on real hardware, and device access is declared but not mediated.

## Dependencies

Framework: `@agent-native/contracts`; `@agent-native/runtime` in `server` only. External: `zod`. `bun run check:boundaries` keeps `@agent-native/devices/server` out of browser code.

## Tests

```sh
bun test packages/devices
```

- `test/scanner.test.ts`: layout repair (US scanner on QWERTZ or Swiss hosts, dead keys), GS1 check digits and fields, AIM identifiers, calibration inference, routing, serial line assembly, HID POS reports, camera repeat suppression, wedge bursts and the host bridge.
- `test/config.test.ts`: administrators configure, operators read, strangers see nothing; stale route writers conflict ([P8](../../docs/principles.md#p8--specialize-by-composition-and-configuration)).
