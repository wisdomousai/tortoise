# @agent-native/egress

The only path from server code, and from declared child processes, to the network. Requirements declared in the catalog say what may be reached; a site policy binds declarations to addresses and sets a hardening floor; the guard and the CONNECT proxy enforce the binding in-process and record every decision. Without a policy the application is isolated: loopback only, outbox targets queue and providers report unavailable.

Layer: framework (`packages/*`). Server only.

## Primitives

- [Site policy](../../docs/primitives.md#site-policy): `sitePolicySchema`, `SitePolicy`, `hardeningProfiles`, `loadSitePolicy`, `resolveSitePolicy`, `assertPolicyUsable`, `isolatedPolicy`, `ResolvedPolicy`, `PolicyFinding`.
- [Egress guard](../../docs/primitives.md#egress-guard): `createEgress`, `Egress`, `DestinationClient`, `EgressDenied`, `startEgressProxy`.
- [Execution host](../../docs/primitives.md#execution-host): `startEgressProxy` confines declared children to their destinations.

[Security and assurance](../../docs/security-and-assurance.md) and [ADR 007](../../docs/decisions/007-declared-egress-and-audit-log.md) describe the model.

## Entrypoints

| Import                   | Runs in     | Contents                                               |
| ------------------------ | ----------- | ------------------------------------------------------ |
| `@agent-native/egress`   | server only | Policy, guard, proxy and CIDR helpers.                 |
| `@agent-native/egress/*` | server only | One source file: `policy`, `guard`, `proxy` or `cidr`. |

## Trust boundary

A destination-scoped client allows only the bound scheme, host and port. It rechecks every redirect hop, checks DNS answers against the bound networks before connecting, applies CA bundles and certificate pins, and caps response size and time. Provider SDKs get a fetch routed by origin, TCP transports a scoped socket, and declared children a loopback CONNECT proxy that admits only their declared destinations, identified by a per-process credential. Every decision is logged; a refusal is an `UNAVAILABLE` error with a stable `DenialReason`. If a required egress log cannot be written, the connection stays closed.

Bindings must name declared destinations and match their protocol, host and port. In connected mode every required destination is bound or explicitly disabled, and each closed destination lists its offline consequence. The `desktop-local`, `sandbox` and `zero-trust` profiles are floors on plain HTTP, ingress (loopback or mTLS), identity, grant lifetime and audit mode; the host refuses to start below its floor.

This is an in-process control, not an isolation boundary. A child that ignores proxy settings, or a compromised process, is contained only once the OS rules exported by [`@agent-native/assurance`](../assurance/README.md) are applied. `external` identity refuses to start because no workforce identity adapter exists.

## Dependencies

Framework: `@agent-native/contracts`. External: `zod`. Node: sockets, TLS and DNS. This is the one package `check:boundaries` exempts from the direct-network rule; every other exemption is listed in `scripts/boundary-rules.ts`.

## Tests

```sh
bun test packages/egress
```

`test/egress.test.ts` enforces [P13](../../docs/principles.md#p13--the-application-reaches-only-what-it-declares-and-the-site-binds-and-records-what-it-does): host, port, scheme, redirect and DNS escapes refused; response caps; isolated default; binding validation; profile floors and mTLS listeners; proxy tunnels limited to declared destinations. `bun run test:isolated` runs the whole suite with a trap that fails on any non-loopback connection.
