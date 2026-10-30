# @agent-native/network

The host's only way off the machine. `openNetwork` installs an egress guard that allows only the destinations the site policy binds, a loopback proxy for child processes, and optional mutual-TLS ingress. A destination-scoped client allows only the bound scheme, host, port and addresses; provider SDKs get a fetch routed by origin, and TCP transports get a scoped socket. `bun run cli network export --format json` prints the resolved rules (default egress `deny`).

Primitives:

- [Egress guard](../../docs/primitives.md#egress-guard)
- [Execution host](../../docs/primitives.md#execution-host)
- [Host plugin](../../docs/primitives.md#host-plugin)

## References

- [Security and compliance: egress](../../docs/security-and-compliance.md#egress)
- [deploy-to-site](../site/skills/deploy-to-site/SKILL.md)
- `bun test plugins/network`
