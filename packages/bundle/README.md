# @tortoise/bundle

Creates and verifies the site bundle: one signed, versioned artifact per application and platform. Nothing from a bundle runs before `verifyBundle` passes, and the signature must come from a key the site lists.

- Primitives: [Site bundle](../../docs/primitives.md#site-bundle).

## References

- [deploy-to-site](../../plugins/site/skills/deploy-to-site/SKILL.md), [decommission-an-application](../../plugins/site/skills/decommission-an-application/SKILL.md)
- [Security and compliance](../../docs/security-and-compliance.md#compliance-bundle)
