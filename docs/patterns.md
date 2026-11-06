# Extension patterns

A pattern application isolates one framework extension point so its composition and tests can be inspected.

## Composition

Applications under `showcase/patterns/` share the unchanged base package. A pattern's manifest includes the base module and declares its added contribution. Its server mounts base handlers on the base state slice, then registers the extension's handlers and access policy. The screens reuse the base routes and add their own UI contribution.

The base package owns its records and policy. A reusable feature gets the access view defined by the application that mounts it. A pattern must not modify the base to make its extension work; a capability intended for general composition belongs in the owning framework package or plugin.

This composition allows the extension's behavior to be checked with the base still present. Tests must cover the declared extension contract and its interaction with the base. A passing pattern test establishes the behavior exercised by that fixture, under its configured host.

## Running and checking

A pattern's README names its launch command and any required local services. From the repository root, the pattern test suite runs with:

```sh
bun test showcase/patterns
```

A pattern that starts an external-service stand-in establishes the connector's behavior against that stand-in. Hardware or provider behavior requires separately configured execution and its own evidence. The [implementation status](implementation-status.md) records known gaps and dated runs.

[Architecture](architecture.md) defines the extension boundaries. The [concept reference](primitives.md) identifies the packages that implement them. Application construction is documented in the [tutorials](tutorials/index.md).
