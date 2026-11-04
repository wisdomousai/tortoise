# @tortoise/network

The host's only way off the machine. `openNetwork` installs a network guard that allows only the destinations the site policy binds, a loopback proxy for child processes, and optional mutual-TLS ingress. A destination-scoped client allows only the bound scheme, host, port and addresses; provider SDKs get a fetch routed by origin, and TCP transports get a scoped socket. `bun run cli network export --format json` prints the resolved rules (`defaultNetwork` is `deny`).

Primitives:

- [Network guard](../../docs/primitives.md#network-guard)
- [Execution host](../../docs/primitives.md#execution-host)
- [Host plugin](../../docs/primitives.md#host-plugin)

## References

- [Security and compliance: network guard](../../docs/security-and-compliance.md#network-guard)
- [deploy-to-site](../site/skills/deploy-to-site/SKILL.md)
- `bun test plugins/network`
