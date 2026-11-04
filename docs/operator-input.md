# Operator input

Two kits support operator screens at a workstation:

- [`packages/devices`](../packages/devices/README.md) — scanner profiles, sources, decoding, calibration, routing, and a reusable module for per-station device configuration.
- [`packages/operator-ui`](../packages/operator-ui/README.md) — the `operator` UI registry of glove-sized parts.

`winding-line` uses both kits, and the `quality-inspection` capture screen uses parts of the registry.

## Design guidelines

- **No precision gestures.** Targets follow the operator size tokens, larger at glove density. Gloves break:
  - drag
  - double-tap
  - long text entry
  - small close buttons
  - hover-only affordances
  - swipes
- **Scanner and keypad first.** A task works with a scanner, a numeric keypad or a pedal mapped to keys. Touch is the fallback. Typing is the last resort.
- **Fixed layout.** The screen shows:
  - the operator and the station at the top
  - station signals
  - the current task
  - what needs a person
  - screen control

  The layout stays fixed during a press.
- **`hold-to-confirm`.** Starting an order, confirming counts or reporting a held procedure takes a long press instead of a tap. The press cancels when the finger slides off.
- **Tap guard.** A tap guard ignores double taps, taps during scroll or layout shift, and taps while a request is pending.
- **Icon plus text.** State readable from 1–2 m. Color is never the only signal. Observed values show age and confidence.
- **Feedback by sound.** Distinct tones mark scanned, accepted, rejected and attention, with vibration where available. Each device mutes independently.
- **Digit keys.** Where digit hotkeys pick tiles, the numeric pad is touch-only. A wedge scanner's keystroke burst, including its final Enter, never fires a hotkey.

Delivery state shows as one of:

- pending
- retrying
- held
- accepted, with the system of record's reference
- rejected, with the code

## Operator UI registry

The `operator` registry uses stock shadcn primitives and adds glove sizing through variants and theme tokens. It forks no primitive.

| Kind | Items |
| --- | --- |
| Theme | Target, gap and text tokens; glove density and high-contrast scopes; ok, pending, attention and fault states. |
| Hooks | `hold-to-confirm`, tap guard, feedback tones, idle return, scan-safe keypad and pedal bindings, scanner. |
| Library | Decimal entry with comma or period, decimals and tolerance verdicts. |
| Components | Operator surface, big action, tile picker, numeric pad, scan prompt, status strip, attention queue, takeover button. |
| Blocks | Scanner setup with calibration, profile and live test; the station layout. |

`bun run build:registry:operator` generates and builds the registry from its manifest. The generator fails when an item imports something it does not declare. `bun run check:registry:operator` fails on drift. Inside this repository, the frame's Vite plugin resolves registry sources in place, matching the import paths an application gets after `shadcn add`.

The scanner items depend on `packages/devices`, not yet on a public registry. Outside this repository, install it from a registry as [framework packages](development-and-testing.md#framework-packages) describes, or vendor it.

A gallery route, `station/kit` in `winding-line`, renders every part at desk, touch and glove density. The `winding-line` browser specs use it for interaction tests.

## Scanner profiles

A scanner profile describes one scanner as the station sees it. Fields:

- the transport
- the prefix, suffix and terminator it adds, and the maximum gap between keys
- the minimum length, and whether it sends AIM symbology identifiers
- the GS1 group-separator substitute
- the keyboard layout it emulates

Profiles are configuration without secrets. Each station stores its own.

## Sources

Each transport is a source the application registers explicitly.

| Transport | Reached through | Notes |
| --- | --- | --- |
| `wedge` | Keyboard events | Any scanner that emulates a keyboard; the cheapest and most common kind. Timing tells it apart from typing. |
| `serial` | Web Serial | USB-COM and RS-232 adapters. |
| `hid-pos` | WebHID, barcode usage page | The source reassembles reports. |
| `camera` | `BarcodeDetector` or an injected decoder | The source drops repeated reads. |
| `host-plugin` | A host scanner bridge | For vendor SDKs on the station PC. Only a fake bridge exists. |
| `intent` | An Android broadcast intent | Rugged Android devices; the receiver ships in [`plugins/intent-scanner`](../plugins/intent-scanner/README.md). |

Sources that need a user gesture to connect:

- serial
- HID
- camera

The setup block offers a connect button for each. Every source except wedge and intent is a device requirement, listed in the security manifest.

An intent profile names:

- the broadcast action
- the string extra that contains the data
- an optional sender permission

Any app on the device can send the action unless the profile sets a sender permission that only the scanner app has.

## Decoding

Every source decodes through the same steps:

1. Strip the prefix and suffix.
2. Parse an AIM identifier into a symbology.
3. Parse GS1 element strings and validate their check digits.
4. Correct keyboard-layout mismatches for wedge input.

A scanner emulating a US keyboard on a German or Swiss host types `z` for `y`, swaps punctuation and loses characters to dead keys. It often drops or replaces the group separator. The decoder supports US, German and Swiss German layouts.

## Calibration

The setup block shows a calibration barcode containing the characters most likely to break. From one scan, calibration infers:

- the terminator and the key timing
- any prefix or suffix
- AIM identifiers
- the layout mismatch
- the separator substitute

Calibration suggests a profile and reports problems no setting fixes. It also works for wedge scanners without configuration software. No vendor programming barcodes ship; those come from vendor data supplied with the deployment.

## Scan routing

A scan router maps a scan to an intent without a model turn. A route matches a GS1 application identifier or a regular expression, optionally limited to certain symbologies. First match wins. A capture group becomes the routed value. The application submits the same command a button or tool call would; policy still authorizes it.

## Device configuration

The `device` feature reads and saves scanner profiles and scan routes per station. Writes include expected revisions — a stale writer conflicts. The feature compiles routes before storing them, so an invalid pattern fails at configuration time.

The mounting application decides who may change the configuration through a station relation. In `winding-line`, supervisors administer their station; others with a role read it.

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

- No source has run with a physical scanner.
- The desktop shell does not grant Web Serial or WebHID permissions.
- Apps declare device access; the host does not mediate it.
- Nobody has compiled or run the intent receiver.

## References

- [Operator workstations](operator-workstations.md)
- [Systems of record](systems-of-record.md)
- [`packages/devices`](../packages/devices/README.md)
- [`packages/operator-ui`](../packages/operator-ui/README.md)
- [`plugins/intent-scanner`](../plugins/intent-scanner/README.md)
- [add-scanner-input skill](../packages/devices/skills/add-scanner-input/SKILL.md)
