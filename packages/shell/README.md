# @agent-native/shell

OS handlers (links, shares and shortcuts coming in) and OS actions (opening things going out), with platform registrations generated from the same declarations. A raw request comes from an unauthenticated sender on the device, so `matchOsRequest` accepts only this application's scheme, its `web+` form, and `https` links on a configured verified host for a handler that declares `verified`.

- Primitives: [OS handler](../../docs/primitives.md#os-handler), [OS action](../../docs/primitives.md#os-action), [Shell port](../../docs/primitives.md#shell-port), [Generator](../../docs/primitives.md#generator).

## References

- [add-os-integration](skills/add-os-integration/SKILL.md)
- [Desktop](../../docs/desktop.md), [Mobile](../../docs/mobile.md)
