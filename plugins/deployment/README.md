# @tortoise/deployment

Applies the deployment policy. `openDeployment` checks it against the app's declared requirements and hardening floor, then hands it to the network, audit and compliance plugins. The `deployment-policy` setting (`--deployment-policy` or `TORTOISE_DEPLOYMENT_POLICY`) is a trusted launcher input; without a policy the application runs isolated and needs nothing from other plugins. `bun run cli policy check --policy <file>` checks a policy without starting the app.

Primitives:

- [Deployment policy](../../docs/primitives.md#deployment-policy)
- [Bundle](../../docs/primitives.md#bundle)
- [Workforce sign-in](../../docs/primitives.md#workforce-sign-in)
- [Host plugin](../../docs/primitives.md#host-plugin)

## References

- [deploy-an-application](skills/deploy-an-application/SKILL.md), [decommission-an-application](skills/decommission-an-application/SKILL.md)
- [Security and compliance: deployment policy](../../docs/security-and-compliance.md#deployment-policy)
- [Application lifecycle](../../docs/application-lifecycle.md)
- `bun test apps/desktop/test/deployment-policy.test.ts`
