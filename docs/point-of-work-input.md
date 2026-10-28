# Point-of-work input

Two domain-neutral kits support [operator](glossary.md#operator) screens at a [workstation](glossary.md#workstation):

- [`packages/devices`](../packages/devices/README.md): scanner profiles, sources, decoding, calibration and routing, plus a reusable [module](glossary.md#module) for per-station device configuration.
- [`packages/operator-ui`](../packages/operator-ui/README.md): the `operator` [UI registry](glossary.md#ui-registry) of glove-sized parts.

`winding-line` uses both kits, and the `quality-inspection` capture screen uses parts of the registry.

## Concepts

Terms: [scanner profiles](glossary.md#scanner-profile), [input sources](glossary.md#input-source) and scan routes.

## Design guidelines

- **No precision gestures.** Drag, double-tap, long text entry, small close buttons, hover-only affordances and swipes fail with gloves. Targets follow the operator size tokens, which are larger at glove density.
- **Scanner and keypad first.** A task should work with a scanner, a numeric keypad or a pedal mapped to keys. Touch is the fallback, and typing is the last resort.
- **Fixed layout.** The screen shows the operator and the station at the top, then station signals, the current task, what needs a person, and screen control. The layout stays fixed during a press.
- **Hold to confirm.** Starting an order, confirming counts or reporting that a held procedure took effect takes a hold instead of a tap. The hold cancels when the finger slides off.
- **Tap guard.** A tap guard ignores double taps, taps during scroll or layout shift, and taps while a request is pending.
- **Icon plus text.** State is readable from 1 to 2 m, and color is never the only signal. Observed values show their age and confidence.
- **Feedback by sound.** Distinct tones mark scanned, accepted, rejected and attention, with vibration where available. Each device can mute them.
- **Digit keys.** Where digit hotkeys pick tiles, the numeric pad is touch-only. A wedge scanner's keystroke burst, including its final Enter, never fires a hotkey.

Delivery state shows as one of these:

- pending;
- retrying;
- held;
- accepted, with the system of record's reference;
- rejected, with the code.

## Operator UI registry

The `operator` registry declares stock shadcn primitives as dependencies and adds glove sizing through variants and theme tokens. No primitive is forked.

| Kind | Items |
| --- | --- |
| Theme | Target, gap and text tokens; glove density and high-contrast scopes; ok, pending, attention and fault states. |
| Hooks | Hold to confirm, tap guard, feedback tones, idle return, scan-safe keypad and pedal bindings, scanner. |
| Library | Decimal entry with comma or period, decimals and tolerance verdicts. |
| Components | Operator surface, big action, tile picker, numeric pad, scan prompt, status strip, attention queue, takeover button. |
| Blocks | Scanner setup with calibration, profile and live test; the station layout. |

`bun run build:registry:operator` generates the registry from its manifest and builds it. The generator fails when an item imports something it does not declare, and `bun run check:registry:operator` fails on drift. Inside this repository, the frame's Vite plugin resolves registry sources in place, with the import paths an application gets after `shadcn add`.

The scanner items depend on `packages/devices`, which is not on a public registry yet. Outside this repository, install it from a registry, as [framework packages](development-and-testing.md#framework-packages) describes, or vendor it.

A gallery route, `station/kit` in `winding-line`, renders every part at desk, touch and glove density. The `winding-line` browser specs use it for interaction tests.

## Scanner profiles

A scanner profile describes one scanner as the station sees it:

- the transport;
- the prefix, suffix and terminator it adds, and the maximum gap between keys;
- the minimum length, and whether AIM symbology identifiers are enabled;
- the GS1 group-separator substitute;
- the keyboard layout it emulates.

Profiles are configuration without secrets, and are stored per station.

## Sources

Each transport is a source that is registered explicitly.

| Transport | Reached through | Notes |
| --- | --- | --- |
| `wedge` | Keyboard events | Any scanner that emulates a keyboard; the cheapest and most common kind. Told apart from typing by timing. |
| `serial` | Web Serial | USB-COM and RS-232 adapters. |
| `hid-pos` | WebHID, barcode usage page | Reports are reassembled. |
| `camera` | `BarcodeDetector` or an injected decoder | Repeated reads are filtered. |
| `host-plugin` | A host scanner bridge | For vendor SDKs on the station PC. Only a fake bridge exists. |
| `intent` | An Android broadcast intent | Rugged Android devices; the receiver ships in [`plugins/intent-scanner`](../plugins/intent-scanner/README.md). |

Serial, HID and camera sources need a user gesture to connect, so the setup block offers a connect button. Each source except the wedge and the intent is declared as a device requirement, so the security manifest lists it.

An intent profile names the broadcast action, the string extra that holds the data and an optional sender permission. Any app on the device can send the action unless the profile sets a sender permission that only the scanner app holds.

## Decoding

Every source decodes through the same steps:

1. strip the prefix and suffix;
2. parse an AIM identifier into a symbology;
3. parse GS1 element strings and validate their check digits;
4. correct keyboard-layout mismatches for wedge input.

A scanner emulating a US keyboard on a German or Swiss host types `z` for `y`, swaps punctuation and loses characters to dead keys. The group separator is often dropped or replaced. The supported layouts are US, German and Swiss German.

## Calibration

The setup block shows a calibration barcode that holds the characters most likely to break. From one recorded scan, calibration infers:

- the terminator and the key timing;
- any prefix or suffix;
- AIM identifiers;
- the layout mismatch;
- the separator substitute.

It suggests a profile and reports problems that no setting can fix. This works for cheap wedge scanners that have no configuration software. The kit ships no vendor programming barcodes; those come from vendor data supplied with the deployment.

## Scan routing

A scan router maps a scan to an intent without a model turn. A route matches a GS1 application identifier or a regular expression, optionally limited to some symbologies. The first matching route wins, and a capture group becomes the routed value. The application then submits the same [command](glossary.md#command) a button or a tool call would, and policy still authorizes it.

## Device configuration

The `device` [feature](glossary.md#feature) reads and saves scanner profiles and scan routes per station. Writes include expected [revisions](glossary.md#revision), so a stale writer conflicts. Routes are compiled before they are stored, so an invalid pattern fails at configuration time. The mounting application decides who may change the configuration through a station relation. In `winding-line`, a station's supervisors administer it, and others with a role at that station read it.

## Use

```sh
bun test packages/devices
bun test packages/operator-ui
bun test plugins/intent-scanner
bun run check:registry:operator
```

- `packages/devices/test/scanner.test.ts`: decoding, check digits, AIM parsing, layout repair, calibration, serial and HID assembly, camera repeat filtering, wedge bursts and routing.
- `packages/devices/test/config.test.ts`: the device module's policy and stale route writers.
- `packages/operator-ui/test/primitives.test.ts`: numeric entry, the tap guard, key-burst filtering and registry drift.
- `plugins/intent-scanner/test/source.test.ts`: the intent source over a fake receiver.

`showcase/examples/winding-line/e2e/station.pw.ts` covers the kit and the bound workstation screen in Chromium.

## Limits

- No physical scanner has been checked, and no source has run on real hardware.
- The desktop shell does not grant Web Serial or WebHID permissions.
- Device access is declared but not mediated.
- The intent receiver has not been compiled or run.

## References

- [Operator workstations](operator-workstations.md)
- [Systems of record](systems-of-record.md)
- [`packages/devices`](../packages/devices/README.md)
- [`packages/operator-ui`](../packages/operator-ui/README.md)
- [`plugins/intent-scanner`](../plugins/intent-scanner/README.md)
- [add-scanner-input skill](../packages/devices/skills/add-scanner-input/SKILL.md)
