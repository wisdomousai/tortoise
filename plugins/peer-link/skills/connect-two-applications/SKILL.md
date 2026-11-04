---
name: connect-two-applications
description: Let one agent-native application call another, as its service principal or on behalf of a mapped person, through the peer link host plugin. Use when an application's command must reach another agent-native application's records, when it reads that application's records live as the signed-in person, or when writing or testing a peer API, a peer target, enrollment, subject mappings or the subject assertion. Covers definePeerApi, definePeerTarget, createPeerLinkPlugin with api and targets, peerAllowlist, connectPeerTarget, createPeerSource, startPeerPair and peerNetworkFixture.
---

# Connect two applications

The called application publishes a peer API and serves it with `@tortoise/peer-link`. The calling application declares that application as a target and delivers outbox effects to it and reads it through the same plugin. A call either runs as the caller's service principal there, `peer:<id>`, or on behalf of a person, under that person's own policy.

## Before writing

- List each operation the caller needs. Commands that announce or hand over work, and feeds, run as the service principal. Commands and reads that a specific person does, and that the called application's policy must decide for that person, run on behalf of the person.
- `definePeerApi` refuses a command on behalf of a person that takes blobs. Such a call includes a grant, so a rule marked `person: true` refuses it, as it refuses any delegated caller.
- Calls on behalf of a person that an agent or job run made on the caller are refused unless the called application passes `agents: 'allow'`. Effects record the run that enqueued them.
- Decide how people are matched: one by one through `peer.subject.map`, or by the same principal ID when both applications sign in the same workforce (`subjects: 'same'` on the enrollment).

## Steps

1. In the called application's browser-safe contracts, declare the API with `definePeerApi({ application, commands, queries, onBehalfOf })`, as `showcase/examples/quality-inspection/contracts/peer.ts` does. Every operation already exists in its catalog.
2. In the called application's policy, add `peerAllowlist(api)` from `@tortoise/integration` to `integrations` and give each service operation a rule, usually `'integration'`. Name the integration principals in `reserved`, so no subject maps to them.
3. Compose the peer link in the called application: `peerLinkPluginManifest` in the manifest's plugins and `createPeerLinkPlugin({ api, reserved })` in the application's plugins, with the deployment and network plugins that open its listener.
4. In the calling application, declare the target with `definePeerTarget({ target, api, destination, ... })` and list `target.component` in the manifest's `components`, so the deployment binds its destination. Build effects with `target.effect(command, { resource, payload })` in commands, as `showcase/examples/receiving/contracts/quality-peer.ts` and `handlers/quality-peer.ts` do.
5. Compose `createPeerLinkPlugin({ targets: [target] })` in the calling application; `peerLinkServiceOf` comes from `@tortoise/peer-link/plugin`. In its `connect`, deliver with `connectPeerTarget({ target, link: () => peerLinkServiceOf(services)!.link(target.target), ... })` and read with `createPeerSource` for data providers, passing one `createPeerDrift` to both. The `connect-system-of-record` skill (`packages/integration/skills/connect-system-of-record/SKILL.md`) covers completion, the feed and data providers.
6. Bind the destination in the caller's deployment policy with an `https` URL, its addresses and the local CA. The deployment plugin refuses a plaintext binding of an authenticated destination off loopback.
7. Connect: on the called application's peers screen, create an enrollment code; on the caller's peers screen, enter it for the target. Map the caller's people on the called side.
8. To hand work to another application and take its reports back, put `assignments.assignees.peer` in the issuing application's peer API, as `showcase/patterns/assignments/contracts.ts` does. The taking application declares a worklist with `defineWorklist` and delivers through `connectWorklist`, as `showcase/patterns/worklist/application.ts` does. The `assign-work` skill (`packages/assignments/skills/assign-work/SKILL.md`) covers both sides.

Never take the subject from command input: it comes only from `effect.principalId` or the caller's context. Never send the peer credential or an assertion through anything but the link's clients; they strip caller-set `Authorization`, `Cookie` and `Tortoise-Subject` headers and refuse redirects.

## Checks

- `plugins/peer-link/test/security.test.ts` shows the assertion checks a called application relies on, and `plugins/peer-link/test/link.test.ts` shows two hosts started with `startPeerPair` and `peerNetworkFixture` from `@tortoise/peer-link/testing`. Use the same harness for an application pair's own test: `showcase/examples/receiving/test/quality-peer.test.ts` starts two example applications with their own network plugins, passes each host's options through `hosts`, and binds the destination in the caller's deployment policy to a test gateway that drops responses or rewrites the contract.
- Test the unmapped person, the disconnected target and a drifted operation as well as the happy path.

```sh
bun test plugins/peer-link
bun test showcase/examples/<app>
```

`plugins/peer-link/test/tls.test.ts` runs the pair over TLS with a throwaway local CA. Record a run across two machines separately in [implementation status](../../../../docs/implementation-status.md).

## References

- [Peer link plugin](../../README.md)
- [Integration package: peer applications](../../../../packages/integration/README.md#peer-applications)
- [Systems of record](../../../../docs/systems-of-record.md)
