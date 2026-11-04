# Asset survey on a phone

The field application receives assignments from the [asset survey hub](../asset-survey/README.md) into a local worklist. A worker opens the assigned site structure, photographs equipment and saves captures offline; on reconnection the device sends reports and photos to the hub, which makes its own acceptance decision. The phone has its own workspace and shares only the hub's browser-safe survey contracts.

```sh
export AGENT_NATIVE_MOBILE_APPLICATION=@tortoise/asset-survey-field
bun run mobile:prepare
bun run mobile:prebuild
bun run dev:mobile
```

## What to try

- Build and install a development client as [`apps/mobile`](../../../apps/mobile/README.md) describes; Metro alone is not an installed app.
- Start the hub, create an enrollment code on **Devices** and pair the phone.
- Capture offline, reconnect, and watch the hub accept or refuse each report.
- To export hub and phone together: `bun run scaffold <target> --name field-survey --example asset-survey-field`, then in `app.config.json` set `application` to `@tortoise/asset-survey` and `targets.mobile.application` to `@tortoise/asset-survey-field`.

The recorded evidence has no device run of the native screens, camera, scanner, managed configuration or pairing.

## References

- [Mobile](../../../docs/mobile.md)
- Primitives: [worklist](../../../docs/primitives.md#worklist)
- `bun test showcase/examples/asset-survey-field`
