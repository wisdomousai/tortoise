# @tortoise/contracts

`@tortoise/contracts` defines browser-safe operation declarations. A capability describes its input and output schemas with the permission the runtime must enforce. Application modules combine these declarations into the catalog used by the host and its channels.

`defineCapability` creates an operation declaration. `buildCatalog` validates the composed modules before use. Schemas must represent JSON without a transformation step; `jsonSchema` rejects a value that validation would silently strip or transform. Server handlers belong in a separate entrypoint.

## References

[add-capability](../runtime/skills/add-capability/SKILL.md)

[Capability authoring](../../docs/capability-authoring.md)
