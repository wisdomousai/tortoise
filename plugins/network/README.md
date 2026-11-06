# @tortoise/network

`@tortoise/network` provides destination-scoped network access for host components. `openNetwork` resolves allowed destinations from deployment policy and supplies clients that enforce their bindings. Child processes use the configured loopback proxy. The plugin can also provide TLS ingress.

The guard checks the bound origin and resolved addresses for an outgoing request, including redirects. It runs inside the host process and does not contain unrelated processes on the machine. `bun run cli network export --format json` writes the resolved network rules for inspection.

## References

[Security and compliance: network guard](../../docs/security-and-compliance.md#network-guard)

[deploy-an-application](../deployment/skills/deploy-an-application/SKILL.md)

`bun test plugins/network`
