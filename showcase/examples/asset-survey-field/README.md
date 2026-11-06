# Asset survey on a phone

This hypothetical mobile application receives assignments from the [survey hub](../asset-survey/README.md). It saves captures in its own workspace while offline and sends reports with photos when the hub becomes reachable. The hub applies its acceptance policy to each report.

The application imports the hub's browser-safe survey contracts. It does not open the hub's database. Native device behavior remains subject to the recorded limits below.

```sh
export TORTOISE_MOBILE_APPLICATION=@tortoise/asset-survey-field
bun run mobile:prepare
bun run mobile:prebuild
bun run dev:mobile
```

## What to try

Build and install a development client as [`apps/mobile`](../../../apps/mobile/README.md) describes; Metro alone is not an installed app.

Start the hub, create an enrollment code on **Devices** and pair the phone.

Capture offline, reconnect, and watch the hub accept or refuse each report.

To export hub and phone together: `bun run scaffold <target> --name field-survey --example asset-survey-field`, then in `app.config.json` set `application` to `@tortoise/asset-survey` and `targets.mobile.application` to `@tortoise/asset-survey-field`.

The recorded evidence has no device run of the native screens, camera, scanner, managed configuration or pairing.

## References

[Mobile](../../../docs/mobile.md)

`bun test showcase/examples/asset-survey-field`
