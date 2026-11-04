# @tortoise/site

Applies the site's deployment policy. `openSite` checks it against the app's declared requirements and hardening floor, then hands it to the network, audit and compliance plugins. The `site-policy` setting (`--site-policy` or `TORTOISE_SITE_POLICY`) is a trusted launcher input; without a policy the application runs isolated and needs nothing from other plugins. `bun run cli site check --site <file>` checks a policy without starting the app.

Primitives:

- [Deployment policy](../../docs/primitives.md#deployment-policy)
- [Site bundle](../../docs/primitives.md#site-bundle)
- [Workforce sign-in](../../docs/primitives.md#workforce-sign-in)
- [Host plugin](../../docs/primitives.md#host-plugin)

## References

- [deploy-to-site](skills/deploy-to-site/SKILL.md), [decommission-an-application](skills/decommission-an-application/SKILL.md)
- [Security and compliance: deployment policy](../../docs/security-and-compliance.md#deployment-policy)
- [Application lifecycle](../../docs/application-lifecycle.md)
- `bun test apps/desktop/test/site-policy.test.ts`
