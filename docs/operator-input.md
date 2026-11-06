# Operator input

The devices package converts registered scanner sources into decoded scans and routes them to application actions. Scanner configuration belongs to a station. The application remains responsible for the operation it submits from a routed scan and the policy authorizing that operation.

The operator UI registry supplies screen components with density and input behavior intended for workstation use. Applications can use those components with the devices package without changing the framework's command boundary.

## Design guidelines

Choose target sizes through the operator density tokens. A layout must remain stable while a control is pressed. Actions that require confirmation can use `hold-to-confirm`, which cancels when the pointer leaves its target. The tap guard suppresses repeated taps and input received during scrolling or layout movement, including while a request is pending.

A scanner route must remain usable without precise pointer input. Numeric entry can use the scan-safe keypad or declared keyboard and pedal bindings. When digit hotkeys select screen items, a wedge scanner's key burst and final Enter must not invoke those shortcuts. The numeric pad supports touch entry independently.

Status needs readable text in addition to its color. Observed values need their age and confidence where a person uses them to decide. The feedback hook provides distinct tones for scan and operation outcomes. Vibration depends on the device, and each device can mute feedback independently.

An application's displayed delivery state should follow its stored effect outcome. A pending local command result does not establish that an external system accepted the work. [Systems of record](systems-of-record.md#effect-phases) defines the framework phases.

## Operator UI registry

The registry uses stock shadcn primitives with operator variants and theme tokens. It includes numeric entry and scanner-setup components. The supporting hooks implement confirmation and guarded input, with feedback and idle-return behavior available to the screen.

`bun run build:registry:operator` generates the registry from its manifest. Generation rejects an undeclared item dependency. `bun run check:registry:operator` checks the generated files for drift. Within this repository, the frame's Vite plugin resolves registry source at the import path used by an installed item.

Scanner items require `packages/devices`. An external application must install that framework dependency or vendor it with the application. The [operator UI README](../packages/operator-ui/README.md) identifies registry entrypoints.

## Scanner profiles

A profile describes the scanner transport as observed by the station. It configures any prefix and suffix along with its terminator. Wedge profiles specify the maximum inter-key gap used to identify a scan burst and the keyboard layout the scanner emulates. The profile also records minimum data length and AIM-identifier behavior. A group-separator substitute supports scanners whose keyboard output cannot deliver the GS1 separator directly.

Profiles contain configuration and no secrets. Each station stores its own profile.

## Sources

The application explicitly registers each source it uses.

| Transport | Interface | Source behavior |
| --- | --- | --- |
| `wedge` | Keyboard events | Identifies scanner bursts by configured timing |
| `serial` | Web Serial | Reads the serial data stream |
| `hid-pos` | WebHID barcode usage page | Reassembles scanner reports |
| `camera` | `BarcodeDetector` or injected decoder | Filters repeated camera reads |
| `host-plugin` | Host scanner bridge | Exposes a vendor integration port; only a fixture bridge ships |
| `intent` | Android broadcast receiver | Reads a configured intent's data extra |

Serial and HID sources require a user gesture to connect. Camera acquisition requires one as well. The setup block offers connection controls. Wedge and intent sources do not require a device declaration; the other sources do.

An intent profile names the broadcast action and its string data extra. It can require a sender permission. Without that restriction, another app on the device can send the configured action. The native receiver is supplied by [intent-scanner](../plugins/intent-scanner/README.md).

## Decoding

The decoder removes the configured prefix and suffix before interpreting the data. It reads an AIM identifier when present and parses GS1 element strings with check-digit validation. Wedge data is corrected using its keyboard-layout configuration.

The supported layouts are US, German and Swiss German. A scanner and host using different layouts can produce substituted letters or punctuation and lose characters through dead keys. The configured separator substitute restores the GS1 group separator when the scanner cannot type it directly.

## Calibration

The setup block displays a calibration barcode containing diagnostic characters. A scan lets calibration infer the layout mismatch and the scanner's delimiters. Timing and AIM behavior contribute to the proposed profile. The result reports problems that profile settings cannot repair.

Calibration can operate with a wedge scanner that has no configuration software. Vendor programming barcodes are not supplied; deployments must obtain the appropriate programming data from their vendor.

## Scan routing

The router chooses the first route matching the decoded scan. Routes can match a GS1 application identifier or a regular expression and restrict the accepted symbologies. A capture group supplies the routed value.

Routing selects an application intent without invoking a model. The application then submits its command through the normal runtime. The scan does not establish trusted identity or bypass policy.

## Device configuration

The `device` feature stores profiles and routes per station through ordinary capabilities. A write includes expected revisions so a stale edit conflicts. Route compilation happens before storage, causing an invalid pattern to fail during configuration.

The mounting application's station relation determines who can read or change that configuration. The feature does not infer the application's supervisory roles.

## Use

Run package checks from the repository root:

```sh
bun test packages/devices packages/operator-ui plugins/intent-scanner
bun run check:registry:operator
```

Scanner tests exercise decoding and source assembly with fixtures. Configuration tests cover authorization and stale writers. The operator UI tests cover numeric input and the guard hooks. These checks do not establish behavior with a physical scanner.

## Limits

Physical scanner execution remains unverified. The desktop shell does not grant Web Serial or WebHID permissions. Device declarations do not mediate platform device access. The Android intent receiver has no recorded compiled-device run. Dated evidence belongs in [Implementation status](implementation-status.md).

The [scanner-input skill](../packages/devices/skills/add-scanner-input/SKILL.md) describes the application binding. [Operator workstations](operator-workstations.md) describes screen observation and procedure execution.
