# @tortoise/shell

`@tortoise/shell` translates operating-system requests into declared application handlers. It also builds the platform registrations required to expose those handlers and resolves declared outgoing OS actions.

`matchOsRequest` accepts the application's scheme and supported verified-host links. An incoming request is untrusted data; it does not establish a workspace identity. The host's shell adapter delivers it to a session whose command submission still passes through runtime authorization.

## References

[add-os-integration](skills/add-os-integration/SKILL.md)

[Desktop](../../docs/desktop.md), [Mobile](../../docs/mobile.md)
