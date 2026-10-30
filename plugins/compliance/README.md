# @agent-native/compliance

Builds the compliance bundle (security manifest, data flows, control mapping, CycloneDX SBOM) from the catalog and the site policy, and re-checks posture on a timer. Compose `createComplianceHandlers` with `createComplianceState`, and list the Compliance screen from `@agent-native/compliance/plugin-screens`. Its capabilities are queries only: nothing here changes configuration, and the log stays append-only. `bun run cli compliance report --format markdown` prints the posture report.

Primitives:

- [Compliance bundle](../../docs/primitives.md#compliance-bundle)
- [OS handler](../../docs/primitives.md#os-handler)
- [OS action](../../docs/primitives.md#os-action)
- [Host plugin](../../docs/primitives.md#host-plugin)
- [UI registry](../../docs/primitives.md#ui-registry)

## References

- [Security and compliance: compliance bundle](../../docs/security-and-compliance.md#compliance-bundle)
- [deploy-to-site](../site/skills/deploy-to-site/SKILL.md)
- `bun test plugins/compliance`
