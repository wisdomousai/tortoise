# 010 — Cross-cutting concerns are host plugins over a closed kernel

Accepted. Serves [P11](../principles.md#p11--layers-depend-inward-and-an-authority-runs-one-application) and [P13](../principles.md#p13--declared-reach-recorded-actions). It changes how the controls of [ADR 007](007-declared-egress-and-audit-log.md) are wired, not what they are.

**Context.** The host hard-wired one security layer into every application, and every example repeated the same composition code for compliance queries and screens. Adding a cross-cutting concern meant editing the host, and nothing showed how an outside package could extend it.

**Decision.**

- **A plugin is composed like an application.** It has the same three entrypoints as an application (a manifest, a server part and screens), and the application lists its plugins in each of them. Generated artifacts and every surface see plugin operations like the application's own.
- **Plugins are isolated.** A plugin's state lives in its own slice, and its policy decides only its own operations and resource types. Neither the application nor another plugin can rewrite the slice.
- **The kernel is closed by default.** The host exposes ports for network access, inbound connections, identity and an audit log. With no provider, the network refuses every destination, the listener binds loopback, and there is no log.
- **Plugins reach each other through ports, not imports.** A plugin receives a view of the composed ports that resolves once every plugin has opened. Two concerns can therefore use each other without a construction cycle, for example a network guard that records into the log, and a log forwarder that sends through the guard. A plugin may also hand a service to the plugins composed after it.
- **The lifecycle is explicit.** `open` runs before storage, in order, and a refusal there stops startup. `ready` runs before the first request. `start` runs once a serving host listens, and gets a delegated grant, so a background loop is an ordinary caller. `close` runs in reverse order.
- **Configuration that would go unenforced refuses to start.** A plugin claims the settings it reads, and a supplied setting that no plugin claims refuses startup. A plugin also declares the ports its configuration needs, and startup refuses if no composed plugin provides one.
- **Plugins are a layer.** They depend on the framework and on the plugins they require. The framework and the starter never import a plugin.

**Consequences.**

- A cross-cutting concern is a package an application lists, not a change to the host. A forked starter keeps receiving kernel changes.
- An application states its trust posture by the plugins it composes. Leaving one out yields the closed default, never an open one. The generated manifest shows the difference.
- Plugin order is part of the application, because it decides service visibility and the order of `close`.
- How a concern is divided into plugins is a design choice per concern, not a rule. The framework's own split is described in [security and compliance](../security-and-compliance.md).

**Alternatives considered.**

- Security in the host behind a flag: one fewer package, but the host keeps a security concept, and nothing demonstrates extension.
- Plugins registered by the starter: they would apply to whatever application the starter hosts, and artifacts would no longer follow from the application alone.
- Middleware around every call: it cannot express an audit record inside the transaction, binding of outbound connections, or refusal at startup.
