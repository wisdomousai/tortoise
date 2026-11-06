# @tortoise/deployment

`@tortoise/deployment` validates deployment settings against the application's declared requirements. `openDeployment` resolves the policy and supplies it to the host components that enforce it. The launcher provides the trusted `deployment-policy` setting.

A missing policy selects isolated defaults. A configured policy must satisfy its hardening floor and bind each required resource. `bun run cli policy check --policy <file>` evaluates those findings without opening the workspace. The package also implements release installation and decommissioning commands.

## References

[deploy-an-application](skills/deploy-an-application/SKILL.md), [decommission-an-application](skills/decommission-an-application/SKILL.md)

[Security and compliance: deployment policy](../../docs/security-and-compliance.md#deployment-policy)

[Deployment and operation](../../docs/hosting.md)

`bun test apps/desktop/test/deployment-policy.test.ts`
