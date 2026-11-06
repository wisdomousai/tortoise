# @tortoise/compliance

`@tortoise/compliance` derives a compliance report from the catalog and deployment policy. Its monitor reevaluates the configured checks while the host runs. The generated bundle includes a security manifest with the declared data flows and control mappings.

Compose `compliancePlugin` after its deployment and audit dependencies, with the corresponding plugin manifest. Register its screen contribution through the plugin-screens entrypoint. The exposed capabilities read compliance findings. Configuration changes remain the responsibility of their owning components. `bun run cli compliance report --format markdown` returns the current report.

## References

[Security and compliance: compliance bundle](../../docs/security-and-compliance.md#compliance-bundle)

[deploy-an-application](../deployment/skills/deploy-an-application/SKILL.md)

`bun test plugins/compliance`
