# Fleet for site applications

A fleet operator monitors applications at separate sites. Each site's fleet agent enrolls with a one-use code and calls outbound to report health, forward audit events and ask which signed release its channel selects. A site keeps its local work going when the fleet is unavailable.

```sh
cd showcase/examples/fleet
bun run dev:web
```

## What to try

- On **Devices** (port 4340), create a `field-sync` enrollment code.
- Start the [site pattern](../../patterns/site/README.md) against this fleet; it walks through reporting, signing and staging a release on one machine.
- Watch **Sites** and **Health** flag a stale report, held effects, a broken audit chain or release drift.

## References

- [Hosting: fleet](../../../docs/hosting.md#fleet)
- Primitives: [fleet agent](../../../docs/primitives.md#fleet-agent)
- Real parts and stand-ins: [implementation status](../../../docs/implementation-status.md#fleet-agent)
- `bun test showcase/examples/fleet`
