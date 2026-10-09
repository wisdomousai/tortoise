# Point-of-work input

Operator screens are used with gloves, at arm's length or further, by someone watching a machine. Scanners and keypads do most of the input. Two domain-neutral kits support these screens:

- **`packages/devices`**: scanner profiles, sources, decoding, calibration and routing, plus a reusable module for per-station device configuration;
- **`packages/operator-ui`**: a shadcn registry of glove-sized UI parts built from stock primitives.

The `line-station` example and the quality-inspection capture screen use both. The surrounding architecture is in the [operator workstation pattern](operator-workstation-pattern.md).

## Design guidelines

These are the defaults the kit is built for. A screen can depart from them where its setting differs.

1. **Avoid precision gestures.** Drag, double-tap, long text entry, small close buttons, hover-only affordances and swipes fail with gloves. Targets follow the operator size tokens, which are larger at glove density.
2. **Scanner and keypad first.** A task should be possible with a scanner, a numeric keypad or a pedal mapped to keys. Touch is the fallback, and typing is the last resort.
3. **One task at a time.** Who and where at the top, then station signals, the current task, what needs a person, and seat control. Nothing moves while someone is reaching for it.
4. **Hold to confirm consequential actions.** Starting an order, confirming counts or reporting that a held procedure took effect take a hold, not a tap. A hold cancels when the finger slides off. A tap guard ignores double taps, taps during scroll or layout shift, and taps while a request is pending.
5. **Show state as icon plus text, readable from 1–2 m.** Color is never the only signal. Delivery shows pending, retrying, held, accepted (with the upstream reference) or rejected (with the code), and observed values show their age and confidence.
6. **Give feedback by sound.** Distinct tones mark scanned, accepted, rejected and attention, with vibration where available. Each device can mute them.
7. **Give digit keys one owner.** Where digit hotkeys pick tiles, the numeric pad is touch-only. A wedge scanner's keystroke burst, including its final Enter, never fires a hotkey.

## Operator UI registry

The `operator` registry declares stock shadcn primitives as dependencies and adds glove sizing through variants and theme tokens. No primitive is forked.

| Kind       | Items                                                                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------- |
| Theme      | Target, gap and text tokens; glove density and high-contrast scopes; ok, pending, attention and fault states.        |
| Hooks      | Hold to confirm, tap guard, feedback tones, idle return, keypad and pedal bindings that ignore scan bursts, scanner. |
| Library    | Decimal entry with comma or period, decimals and tolerance verdicts.                                                 |
| Components | Operator surface, big action, tile picker, numeric pad, scan prompt, status strip, attention queue, takeover button. |
| Blocks     | Scanner setup (calibration, profile, live test) and the station layout.                                              |

`bun run build:registry:operator` generates the registry from its manifest and builds it. The generator fails when an item imports something it does not declare, and `check:registry:operator` fails on drift. Inside this repository, the web app resolves registry sources in place, with the same import paths an app gets after `shadcn add`. The scanner items depend on the devices package, which is not yet published, so they can only be pulled outside this workspace once it is published or vendored.

A gallery route renders every part at desk, touch and glove density, and the line-station browser specs use it for interaction tests.

## Scanner kit

### Profiles

A scanner profile describes one scanner as the station sees it:

- the transport: keyboard wedge, serial, HID POS, camera or a host bridge;
- the prefix, suffix and terminator it adds, and the maximum gap between keys;
- the minimum length, and whether AIM symbology identifiers are enabled;
- the GS1 group-separator substitute;
- the keyboard layout it emulates.

Profiles are configuration, not secrets, and are stored per station.

### Sources

Each transport is a source that is registered explicitly; nothing is discovered silently.

| Source      | Browser API                              | Notes                                                                                                      |
| ----------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Wedge       | Keyboard events                          | Any scanner that emulates a keyboard, the cheapest and most common kind. Told apart from typing by timing. |
| Serial      | Web Serial                               | USB-COM and RS-232 adapters.                                                                               |
| HID POS     | WebHID, barcode usage page               | Reports are reassembled.                                                                                   |
| Camera      | `BarcodeDetector` or an injected decoder | Repeated reads are filtered.                                                                               |
| Host bridge | A host-side bridge                       | For vendor SDKs on the station PC. Only a fake exists here.                                                |

Serial, HID and camera sources need a user gesture to connect, so the setup block offers a connect button.

### Decoding

Decoding strips the prefix and suffix and parses AIM identifiers into a symbology. It also parses GS1 element strings and validates their check digits, and corrects keyboard-layout mismatches for wedge input. Layout mismatch is the most common wedge failure. A scanner emulating a US keyboard on a German or Swiss host types `z` for `y`, swaps punctuation, and loses characters to dead keys. The group separator is often dropped or replaced. Supported host layouts are US, German and Swiss German.

### Calibration

The setup block shows a calibration barcode that holds the characters most likely to break. From one recorded scan, calibration infers the terminator, the key timing, any prefix or suffix, AIM identifiers, the layout mismatch and the separator substitute. It suggests a profile and reports problems no setting can fix. This works for cheap wedge scanners that have no configuration software. Vendor programming barcodes have to come from vendor data supplied with the deployment, never from hard-coded values.

### Routing

A scan router maps scans to intents without a model turn. A route matches a GS1 application identifier or a regular expression, optionally limited to certain symbologies. The first match wins, and a capture group becomes the routed value. Each site stores its routes with its device configuration.

### Device configuration

A reusable capability module reads and saves scanner profiles and routes per station, with expected revisions on writes. The composing application decides who may change it; in the starter, station supervisors do.

## Evidence

Deterministic tests cover decoding, check digits, AIM parsing, layout remapping, calibration, serial and HID assembly, camera repeat filtering, routing and the device module's policy. Browser specs cover the kit and the bound station screen.

No physical scanner has been checked yet, and the desktop shell does not yet grant Web Serial or WebHID permissions. A device type counts as supported only once it has been checked and recorded in the [implementation ledger](implementation-status.md#operator-workstation-bridge).
