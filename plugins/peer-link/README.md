# @agent-native/peer-link

Calls between two agent-native applications. The called application publishes a peer surface (`definePeerSurface` in `@agent-native/contracts`) and serves it through this plugin. An administrator creates a one-use enrollment code there. The calling application exchanges the code at the enrollment route for its peer credential, registering an Ed25519 public key. Every later request that presents the credential acts as the peer's service [principal](../../docs/glossary.md#principal), `peer:<id>`. A request that also carries a signed subject assertion acts as the person the subject is mapped to. On the calling application the same plugin connects each declared peer target with a code, keeps the credential and key, and gives the integration package's peer port and peer source their clients.

## Layer

Plugins (`plugins/*`). Bun only, because the called application is a serving [host](../../docs/glossary.md#host).

## Primitives

- [Peer link](../../docs/primitives.md#peer-link): the `peer.*` [capabilities](../../docs/glossary.md#capability), the enrollment route, credential and assertion verification, and subject mappings.
- [Host plugin](../../docs/primitives.md#host-plugin): `createPeerLinkPlugin`, `peerLinkPlugin` and `peerLinkPluginManifest`, with the public-route and credential hooks of a serving host.
- [Capability binding](../../docs/primitives.md#capability-binding): `peerLinkScreens`, the peers [screen](../../docs/glossary.md#screen) at `/peers`.
- [Peer target](../../docs/primitives.md#peer-target): `targets`, the calling side of a target declared with `definePeerTarget`.

## Entrypoints

| Import                                    | Runs in              | Contents                                                                                                                         |
| ----------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `@agent-native/peer-link/contracts`       | browser and any host | `peerLinkOperations`, `peerLinkModule`, `enrollPath`, `connectPath`, `subjectHeader`, and the peer, enrollment, mapping and connection schemas. |
| `@agent-native/peer-link/assertion`       | Bun host             | The subject assertion format: `signSubjectAssertion`, `verifySubjectAssertion`, `generateAssertionKey`, `requestLine`, `bodyDigest`. |
| `@agent-native/peer-link/plugin-manifest` | browser and any host | `peerLinkPluginManifest`, with the setting `peer-link-agents`.                                                                   |
| `@agent-native/peer-link/plugin`          | Bun host             | `createPeerLinkPlugin({ surface?, targets?, agents?, reserved?, now? })`, `peerLinkPlugin` and `peerLinkServiceOf`.             |
| `@agent-native/peer-link/plugin-screens`  | browser              | `peerLinkScreens`: the peer list, enrollment code, revocation, subject mappings, and the connections to peer targets.            |
| `@agent-native/peer-link/testing`         | Bun tests            | `startPeerPair` and `peerNetworkFixture`, for tests of two applications on loopback.                                             |

### Called application

The application passes its surface to `createPeerLinkPlugin({ surface })`. Startup refuses a surface that names another application or a capability the [catalog](../../docs/glossary.md#catalog) lacks. Its [policy](../../docs/glossary.md#policy) gives the service principals their lane with `peerLane(surface)` from `@agent-native/integration`, and a rule for each service operation, usually `integration`.

- **Service calls**: the peer acts as `peer:<id>` with a [grant](../../docs/glossary.md#grant) of the surface's service operations, or of the narrower list the enrollment named. The lane reads no journal events.
- **Calls on behalf of a person**: the peer acts as the person its subject maps to, with a grant of the surface's on-behalf-of operations within the mapping's list. That person's own policy applies, and a person-only rule refuses the call as it refuses any delegated caller. The grant has no expiry, so a redelivered effect keeps its [receipt](../../docs/glossary.md#receipt) fingerprint. Such a call opens no browser session and no event stream.

A subject maps to a person through the subject table (`peer.subject.map`). An enrollment created with `subjects: 'same'` also maps a subject to the principal of the same ID, for two applications that sign in the same workforce. No subject maps to an ID with a `:` (`peer:`, `device:`) or to a principal the application lists in `reserved`, such as its integration principals.

### Calling application

The application declares each peer target with `definePeerTarget` from `@agent-native/contracts`, lists its `component` in the manifest so the deployment binds the target's destination, and passes the targets to `createPeerLinkPlugin({ targets })`. `peerLinkServiceOf(services).link(target)` is the `link` that `connectPeerTarget` and `createPeerSource` take.

- **Connecting**: `POST /api/v1/peer/connect` with `{ target, code }`, or `connect(request, context)` on the service, as a person signed in here. It lists the connections as that person first, so one who may not connect never spends the code. It then redeems the code at the target's enrollment route through the network port to the target's [destination](../../docs/glossary.md#destination), with a new Ed25519 key, refuses an answer from another application with `CONFLICT`, stores the credential and private key, and records the connection through `peer.connection.record`.
- **Secrets**: the credential and key are kept in the host's secret store under `peer-connection-<target>`, or without one in `peer-link/<target>.json` in the workspace, mode 0600 in a 0700 directory. The connection record holds the peer ID, the audience and the target's contract.
- **Calls**: every request re-reads the connection through `peer.connection.list`. A removed connection deletes the secret, and the peer port keeps the effect pending with "connect it on the peers screen". The clients drop caller-set `Authorization`, `Cookie` and `Agent-Native-Subject` headers and refuse redirects. A call on behalf of a person signs `act: agent` when the effect or the read has a run ID.

### Enrollment route

`POST /api/v1/peer/enroll` with `{ code, application, publicKey, contract? }` answers `201 { token, peer: { id, audience }, contract }` with `Cache-Control: no-store`. `publicKey` is the caller's raw Ed25519 key in base64url, and `contract` describes each side's application. Codes are those of `@agent-native/host/enrollment`: ten characters, valid for ten minutes, ten failed exchanges per minute for all callers together.

### Subject assertion

`Agent-Native-Subject: v1.<claims>.<signature>` carries base64url JSON claims and an Ed25519 signature over `v1.<claims>` by the enrolled key:

| Claim  | Value                                                                  |
| ------ | ---------------------------------------------------------------------- |
| `aud`  | The audience the enrollment answered, `<application>#<peer id>`        |
| `sub`  | The caller's principal ID for the person                               |
| `act`  | `person`, or `agent` when a delegated run made the call on the caller  |
| `req`  | `<METHOD> <path and query>` of the request                             |
| `body` | Hex SHA-256 of the request body                                        |
| `iat`  | Issue time in seconds; at most 30 seconds ahead of the callee's clock  |
| `exp`  | Expiry in seconds; at most 120 seconds after `iat`                     |
| `jti`  | 16 to 64 base64url characters, accepted once                           |

## Trust boundary

The enrollment route runs before the session check, so anyone who reaches the listener can reach it. It redeems a code through the [instance](../../docs/glossary.md#instance) as the local [owner](../../docs/glossary.md#owner), narrowed to the redeem and resolve capabilities. One message covers an unknown, an expired and a used code.

The plugin stores SHA-256 digests of codes and credentials, and the peer's public key. The one-use code stays in the stored receipt of `peer.enrollment.create`, where it is worthless once redeemed or expired. The [audit log](../../docs/glossary.md#audit-log) records only the application ID of the redeem input.

Every request with a bearer this plugin issued is resolved through `peer.credential.resolve`, so a revocation or an unmapping applies to the next request. A revoked or unknown credential is refused with `FORBIDDEN` and `details.credential`. The assertion is checked in this order:

1. the signature, by the key enrolled with that credential;
2. the audience;
3. the request line;
4. the body digest, read from a clone of the request, refused above 1 MiB;
5. the time;
6. the `jti`, against a cache of the assertions seen within their lifetime;
7. `act`: `agent` is refused unless the application allows it;
8. the subject mapping.

A refusal is `FORBIDDEN` with `details.assertion` naming the failed check: `signature`, `audience`, `request`, `body`, `expired`, `replayed`, `agent` or `unmapped`. The caller's peer port signs again after `expired` and `replayed`, and keeps an effect pending with a message after `unmapped`.

The `jti` cache is in memory. An assertion captured within two minutes before a restart can be presented once more after it, still only with the peer's bearer credential. A stolen credential together with the private key can assert any mapped subject, within the surface and that person's policy.

The [deployment policy](../../docs/glossary.md#deployment-policy) decides whether a network listener exists at all. A peer destination is declared `authenticated`, so the site plugin refuses a plaintext binding to it off loopback.

## Dependencies

- Framework:
  - `@agent-native/contracts`, `@agent-native/runtime` and `@agent-native/integration` (`peerPrincipal`);
  - `@agent-native/kernel`: `plugin`, `plugin-manifest`, `application` and `instance`, and the default ports for the network fixture;
  - `@agent-native/adapters`: `http`, for the JSON helpers;
  - `@agent-native/host`: `enrollment`, for codes, credentials and the attempt limit; `host` and `plugin-manifest`, for the test harness in `testing`;
  - `@agent-native/frame`, for the screens.
- External: `zod`, `react`, `@tanstack/react-query` and `lucide-react`.

## Tests

```sh
bun test plugins/peer-link
```

- `test/security.test.ts` runs a called application with `startHost` on loopback and calls it over HTTP as an enrolled peer. It covers:
  - enrollment: a single-use code, and a list without codes, credentials or keys;
  - startup refusing a surface of another application or with unknown capabilities;
  - the service principal limited to the service operations and the enrollment's list, and refused as a credential after revocation;
  - calls on behalf of a mapped person under that person's policy, person-only rules, and the grant within the mapping;
  - unmapped subjects, unmapping, reserved principals and `same` subjects;
  - `act: agent` refused unless allowed;
  - launch refused on behalf of a person;
  - expired, too long and future assertions; another audience, key, request line or body; a replayed `jti`; an assertion without the bearer;
  - no credential or private key in any workspace file.
- `test/link.test.ts` starts a receiving and a quality application with `startPeerPair` and covers:
  - the connection record and the 0600 secret file;
  - a code refused for an unknown target, a wrong code and a person who may not connect;
  - a removed connection keeping effects pending and deleting the secret;
  - service delivery as the peer, personal delivery as the mapped person, an effect a run enqueued and an unmapped person;
  - caller-set credential, assertion and cookie headers dropped, and a redirect to another host refused before it is followed;
  - remote reads as the mapped person, an unmapped caller and a read a run made.
- `test/tls.test.ts` runs the pair over TLS through the site and network plugins, with a throwaway site CA, and checks that a client without the CA fails the handshake.
- `test/scenarios.test.ts` runs the `peer.*` [behavioral scenarios](../../docs/glossary.md#behavioral-scenario) through `directDriver`.
- `test/ui-bindings.test.ts` checks that the peers screen references every bound capability.

## Skills

- [connect-two-applications](skills/connect-two-applications/SKILL.md): a peer surface, a peer target, connecting and mapping, and the two-host tests.
- [connect-system-of-record](../../packages/integration/skills/connect-system-of-record/SKILL.md): settlement, the feed and data providers on a peer target.

## References

- [Integration package: peer applications](../../packages/integration/README.md#peer-applications)
- [Device link](../device-link/README.md)
