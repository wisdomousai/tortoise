# @tortoise/bundle

Creates and verifies the bundle: one signed, versioned artifact per application and platform. Nothing from a bundle runs before `verifyBundle` passes, and the signature must come from a key the install lists as trusted.

- Primitives: [Bundle](../../docs/primitives.md#bundle).

## References

- [deploy-an-application](../../plugins/deployment/skills/deploy-an-application/SKILL.md), [decommission-an-application](../../plugins/deployment/skills/decommission-an-application/SKILL.md)
- [Security and compliance](../../docs/security-and-compliance.md#compliance-bundle)
