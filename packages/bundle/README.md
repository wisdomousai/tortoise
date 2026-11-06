# @tortoise/bundle

`@tortoise/bundle` creates signed application payloads and verifies them against trusted public keys. The bundle manifest identifies its target platform and contains the digests used to check its files.

`verifyBundle` checks the signature and payload before the deployment installer uses the bundle. Admission evaluates its declared requirements against deployment policy and the previous admitted requirements. Verification and admission return findings that the caller must handle before installation.

## References

[deploy-an-application](../../plugins/deployment/skills/deploy-an-application/SKILL.md), [decommission-an-application](../../plugins/deployment/skills/decommission-an-application/SKILL.md)

[Security and compliance](../../docs/security-and-compliance.md#compliance-bundle)
