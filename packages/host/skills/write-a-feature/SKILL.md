---
name: write-a-feature
description: Write a feature, a reusable domain part (approval requests, reconciliation, device configuration, a stock ledger) that an application mounts once with its own state slice, handlers, policy over an access view, hooks and connections. Use when a domain part should be reused across applications or moved out of one application's state, when an application mounts a feature, or when data an older application version kept must be adopted into a feature's slice.
---

# Write a feature

A [feature](../../../../docs/glossary.md#feature) contributes [modules](../../../../docs/glossary.md#module) whose operation IDs start with its ID, a state slice under that ID, handlers and a [policy](../../../../docs/glossary.md#policy). It never reads application state: the [application](../../../../docs/glossary.md#application) mounts it with an access view and hooks. A [host plugin](../../../../docs/glossary.md#host-plugin) is a feature with ports, settings and a lifecycle; follow the `write-host-plugin` skill (`packages/host/skills/write-host-plugin/SKILL.md`) when the part needs those.

## Before writing

- Domain behavior for one application is a [capability](../../../../docs/glossary.md#capability) in that application; follow the `add-capability` skill (`packages/runtime/skills/add-capability/SKILL.md`).
- Look in [primitives](../../../../docs/primitives.md#feature) for a feature that already covers the part. Work handed to someone who reports back is the `assignment` feature; follow the `assign-work` skill (`packages/assignments/skills/assign-work/SKILL.md`).
- Pick the ID once. It is the state key, the `feature:<id>` stamp, the services key and the operation namespace, and journal resources and receipts keep it.
- `patterns/review` writes a feature next to the application that mounts it: a four-eyes review whose access view names each record's author, with a panel the application places on its own record screen.

## Steps

In an application made by `scaffold new`, `bun run scaffold add feature <id> [--screens]` writes the manifest, the server part, the access view, the mount, the screens and a test for steps 1 to 7; change them from there.

1. Declare the browser-safe part with `defineFeatureManifest` from `@agent-native/contracts`. Every operation starts with `<id>.`; module, outbox target and remote-read target names are `<id>` or start with `<id>-`. List features it needs in `requires`.
2. Declare the server part with `defineFeature<Slice, Access, Hooks>` from `@agent-native/host/feature`:
   - `state.create` for the slice, and `state.migrations` with a step whenever the slice shape changes;
   - `handlers`, or a function of the `FeatureComposition` when they depend on the application's modules, such as the commands an approval may be requested for;
   - `authorization` with resource types named `<id>` or `<id>-…` and a `FeaturePolicy` over the slice and `access`;
   - `services`, exposed to every handler as `services[<id>]`;
   - `connect`, returning `integrations`, `observe` and `sources` named `<id>` or `<id>-…`.
3. Define `Access` as the questions the policy and handlers need answered about the application, such as `allows(context, action, resource)`. The application answers them from its own state.
4. Define `Hooks` for application work inside a handler, such as recording an outcome on an application record. Hooks are optional members; supply a default in the feature when one is missing. A query's hooks only read: a query whose hook changes the state fails.
5. Decide person-only rules in the feature's own policy (`isDelegated` from `@agent-native/runtime`), not in the access view, so every application gets them.
6. Mount it in the application:
   - list the manifest in `defineManifest({ features })`;
   - mount it in `defineApplication({ features: [mountFeature(feature, { access, hooks, adopt })] })` in the same order;
   - add its screens, declared with `defineFeatureScreens` from `@agent-native/frame/feature-screens`, to `defineScreens({ manifest, features })`; the `build-screens` skill (`packages/frame/skills/build-screens/SKILL.md`) covers screens.
7. In `access`, replicate the gates the application's own policy applies: membership (`caller`), [integration principal](../../../../docs/glossary.md#integration-principal) lanes and delegated-grant scope. The application policy never sees the feature's operations.
8. Remove any application policy rule for the feature's operations and any event rule for its resource types. Composition refuses both when the application policy is built with `definePolicy`.
9. When the data lived in application state before, adopt it:
   - add an application migration step to a new version that removes the old fields, without `compatible`;
   - mount with `adopt: { before: <that version>, from: (stored) => <slice> }`, where `from` reads the application's state as stored;
   - test loading a workspace stored at the old version.

## Checks

```sh
bun test packages/host/test/features.test.ts
bun run check:boundaries
bun run generate
```

Run `featureConformance` from `@agent-native/testing/features` in the feature's tests, with an allow-all and a deny-all access view, sample requests and events over a sample slice, and the person-only operations. Then test the feature through a fixture application in its own package. Those tests cover:

- a hook that writes application state, and a failing handler that rolls the hook's write back;
- adoption of a stored workspace at the version before the move, and older code refusing the result.

Then follow the `check-a-change` skill (`packages/testing/skills/check-a-change/SKILL.md`).

## References

- [Architecture](../../../../docs/architecture.md#features-and-host-plugins)
- [State migration](../../../../docs/primitives.md#state-migration)
- [Review pattern](../../../../patterns/review/README.md)
