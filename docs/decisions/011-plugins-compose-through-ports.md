# 011 — Plugins compose through ports

Accepted. Amends [ADR 010](010-host-plugins.md) and [P13](../principles.md#p13--the-application-reaches-only-what-it-declares-and-the-site-binds-and-records-what-it-does).

**Context.** ADR 010 made cross-cutting concerns host plugins over a kernel with ports, but it gave one plugin all four ports. A deployment could not compose a guarded network without an audit trail, or keep an audit trail without compliance screens. Splitting concerns across plugins exposes two problems that one plugin hid inside a closure:

- Concerns that use each other form cycles. The egress guard records into the audit log, and the audit log forwards through the egress guard.
- A configuration can ask for a control that no composed plugin enforces. A site policy that binds destinations means nothing if nothing provides the network port.

**Decision.**

- **A plugin owns one concern, and its boundary follows the kernel's ports.** A plugin provides the ports of its concern and nothing else.
- **Plugins use each other through the composed ports, not through imports.** `PluginOpenContext.ports` is a late-bound view of the composed ports. Reading it during `open` throws. Once every plugin has opened, it returns whichever plugin provides the port, or the kernel default. `requires` stays for plugins that read another plugin's service, and it orders them. A cycle between two plugins goes through ports, so neither requires the other.
- **A plugin declares the ports its configuration needs.** `PluginInstance.needs` lists ports another plugin must provide. The host refuses to start when a needed port keeps its kernel default. This extends ADR 010's rule for unclaimed settings: a configuration that would go unenforced refuses to start instead of looking enforced.

**Consequences.**

- An application states its trust posture by the plugins it lists. The framework's own plugins are `site`, `network`, `audit` and `compliance`, and their READMEs say which ports each provides and needs.
- Without a provider, a port keeps its default. A guard that records into the event log drops the record, and an audit forwarder that connects through the network port is refused like any other connection.
- Plugins close in reverse order. A plugin that uses a port during `close` must be composed after the plugin that provides it.

**Alternatives considered.**

- One plugin per framework concern bundle, as in ADR 010: no cycles, but no way to compose part of it.
- `requires` in both directions with optional service lookups: each plugin would import the other's types, the construction cycle would remain, and composition order would become significant.
