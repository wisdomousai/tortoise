# @agent-native/site

The site [host plugin](../../docs/glossary.md#host-plugin). It resolves the [deployment policy](../../docs/glossary.md#deployment-policy) against the composed [requirement declarations](../../docs/glossary.md#requirement-declaration) and refuses a policy below its [hardening profile](../../docs/glossary.md#hardening-profile) floor. It enforces the policy's identity floor and hands the resolved policy to the network, audit and compliance plugins.

## Layer

Plugins (`plugins/*`), shipped with the framework. Server only, except `plugin-manifest`. The plugin is composed first. It binds nothing and records nothing on its own: the [`network`](../network/README.md) and [`audit`](../audit/README.md) plugins do, and they require it. It trusts the `site-policy` setting as launcher input and never reads caller input.

## Primitives

- [Deployment policy](../../docs/primitives.md#deployment-policy): `sitePlugin`, `sitePluginManifest`, `openSite`, `siteServiceOf`, `SiteService`, `assertIdentity`, `portsNeeded`, `sitePolicyFor`, `policyErrors`, `siteCommand`, `siteCliCommand`, `siteUsage`, `POLICY_REJECTED_EXIT_CODE`.
  - **Policy** (`policy`): `sitePolicySchema`, `SitePolicy`, `hardeningProfiles`, `loadSitePolicy`, `resolveSitePolicy`, `assertPolicyUsable`, `isolatedPolicy`, `ResolvedPolicy`, `PolicyFinding`. Problems are findings in the order they were found, and `assertPolicyUsable` refuses on any error.
  - **Processes**: `ProcessBinding`, `DeclaredProcess` and `ResolvedProcess` bind a declared process to an absolute executable, arguments, working directory, optional SHA-256 pin and environment. Findings refuse an undeclared or unbound required process, a relative path, and a variable the process plugin owns: proxy, loader or a declared secret.
  - **Certificates** (`policy/certificates`): `ResolvedPolicy.certificates` holds the validity of the listener certificate, the client CA and each destination CA bundle. `loadSitePolicy` reads them without the key. `judgeCertificates` gives `CERTIFICATE_EXPIRED`, `CERTIFICATE_NOT_YET_VALID` and `CERTIFICATE_EXPIRING` at a given time. Load reports them as findings, and adds `CERTIFICATE_INVALID` for a file with no readable PEM.
  - **Addresses** (`cidr`): `parseCidr`, `cidrContains`, `cidrIsPrivate`, `isPrivateAddress`, `isLoopbackAddress`, `isLoopbackHost`, for the networks a binding may resolve to.
- [Task package](../../docs/primitives.md#task-package): `app install <bundle>`, `app status` and `app uninstall` (`installVerb`, `installBundle`, `installStatus`, `uninstall`, `installLayout`, `InstallRecord`). They run in the bundled binary of the application being installed.
- [Workforce sign-in](../../docs/primitives.md#workforce-sign-in): `createWorkforceSignIn`, `WorkforceConfig`, `discover`, `providerJson`, `ProviderMetadata`, `DestinationFetch`, and `workforceIdentityComponent`, which declares the `workforce-idp` destination. Under `identity: external` on a serving host, `openSite` serves the `/auth/sign-in`, `/auth/callback` and `/auth/sign-out` routes as `publicRoute`. It resolves their session cookies through `authenticateCookie`.
- [Host plugin](../../docs/primitives.md#host-plugin): `sitePlugin` is written only against `@agent-native/host/plugin`. It provides the `identity` port and declares the ports its policy `needs`.

### Install

`app install` runs these steps in order:

1. verify the bundle against `--trust`;
2. admit it against the installed release and `--approval`;
3. copy it to `opt/agent-native/<app>/releases/<version>` and verify the copy;
4. render the systemd unit and nftables rules, or the WinSW XML and Windows Firewall script, with the new release's own `network export`;
5. migrate the workspace with that release's `migrate`;
6. repoint `current`.

Data lives in `var/lib/agent-native/<app>`, outside every release, so switching releases never moves it. `--prefix` stages the same tree in another directory. Only `--apply` creates the service account and loads the firewall rules and the service. `--apply` also stops the service before migrating.

## Entrypoints

| Import                               | Runs in            | Contents                                                                                           |
| ------------------------------------ | ------------------ | -------------------------------------------------------------------------------------------------- |
| `@agent-native/site`                 | server only        | The exports on the first Deployment policy line under Primitives.                                        |
| `@agent-native/site/*`               | server only        | One source file each. Only `plugin-manifest` is browser-safe.                                      |
| `@agent-native/site/plugin-manifest` | browser and server | `sitePluginManifest`: the `site-policy` setting and the `workforce-idp` destination.               |
| `@agent-native/site/plugin`          | server only        | `sitePlugin`, for `defineApplication({ plugins })`.                                                |
| `@agent-native/site/open`            | server only        | `openSite`, and `siteServiceOf` for plugins that read the resolved policy.                         |
| `@agent-native/site/policy`          | server only        | The policy schema, `loadSitePolicy`, `resolveSitePolicy` and the resolved types other plugins read. |
| `@agent-native/site/cidr`            | server only        | CIDR parsing and address checks, shared with the network plugin's guard.                           |
| `@agent-native/site/policy-file`     | server only        | `sitePolicyFor` and `policyErrors`, which offline CLI verbs of other plugins use to read a policy. |
| `@agent-native/site/cli`             | server only        | `site check`, the install verbs and `POLICY_REJECTED_EXIT_CODE`.                                   |
| `@agent-native/site/testing` | server (tests, development) | `createIdentityProvider` and `startIdentityProvider`: a stand-in OpenID Connect provider for workforce sign-in. |

What the plugin does at each lifecycle hook:

| Hook       | Effect                                                                                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open`     | Loads the policy, or isolates without one, and refuses one below its floor. Provides `identity`, exposes `{ policy, requirements }` and declares what it needs. |
| `publicRoute`, `authenticateCookie` | Workforce sign-in, only under `identity: external` on a serving host.                                                                    |
| `describe` | `{ profile, policyDigest }` for the `listening` record.                                                                                                         |

## Trust boundary

### Policy input

The `site-policy` setting (`--site-policy` or `AGENT_NATIVE_SITE_POLICY`) is a trusted launcher input. Without a policy, the application is isolated and needs nothing from other plugins. A policy below its profile floor refuses startup. A policy that does not match the schema is refused with `INVALID_INPUT`, and each field it names is in `details`. The plugin never falls back to plain transport or to the local owner.

A supplied policy declares the ports it depends on through `portsNeeded`: `network`, `ingress` or `eventLog`. The host refuses a composition in which no composed plugin provides one of them.

The service at `services.site` holds the resolved policy and the composed requirements. It holds no credentials and no file contents beyond what the policy names.

### Identity admission

`identity.admit` applies the policy's identity, which [security and compliance](../../docs/security-and-compliance.md#identity) describes:

- **`local-owner`**: admits the trusted local owner and a delegated [grant](../../docs/glossary.md#grant).
- **`grant-file`**: admits only a delegated grant.
- **`external`**: admits a delegated grant. A serving host starts without one but issues the local owner no session. An embedded call as the local owner is refused, because it would bypass sign-in.

When `grants.maxTtlSeconds` is set, a delegated grant must expire within it under every identity.

### Workforce sign-in

Workforce sign-in is a public OpenID Connect client with PKCE (S256):

- Its state, nonce and verifier are kept in memory for ten minutes. The state is consumed before the code is exchanged.
- The redirect URI is built from the request's origin, which the host has already checked against its Host header.
- Discovery, keys and the token exchange go only through the network port's `workforce-idp` client.
- `site check` refuses an issuer that is not on that binding's origin. Discovery refuses a document that names another issuer or an endpoint on another origin.
- `verifyOidcIdentity` from `@agent-native/agents/oidc` verifies the ID token, which is then discarded.
- The principal is the configured claim. For `email`, a provider that says the address is unverified is refused.
- The session token is the plugin's own. It goes only into an `HttpOnly; SameSite=Strict` cookie, `Secure` on HTTPS.
- The token is offered only to `authenticateCookie`, never to `authenticate`, so a device's bearer credential never works from a cookie.
- Sign-out checks the Origin itself, because public routes run before the host's origin check.

`startIdentityProvider` in `@agent-native/site/testing` stands in for the provider in tests and development launches. It serves discovery, its keys, a page that signs in one of the configured people, and the token endpoint with the PKCE check. It serves one client and redirects only to loopback. It is never part of a deployment.

### Install verbs

The install verbs trust only what verifies against `--trust`. The copy in the release directory is verified again before anything runs from it. A failed admission, policy check, render or migration leaves `current` on the previous release, with its data untouched.

The service account name is restricted to a plain account name, because it goes into shell commands and unit files. `app status` exits 1 when the active release no longer verifies, and reports the signed best-before date of a verified release. `uninstall` keeps the workspace and the audit log unless `--purge` is given.

Before a purge deletes the data directory, `install/outbox.ts` runs the installed release's `drain` with the service's site policy and audit log. The release is verified against `--trust` first, because it runs with the installer's rights. While effects remain pending, held or awaiting their target's decision, the purge is refused with `CONFLICT` and the counts by target, and nothing is removed. `--discard-undelivered` purges anyway and lists what it deleted.

`install/native.ts` is the plugin's one exemption from the process rule in `check:boundaries`. It runs only in these site operator verbs, never inside an instance.

### Known gaps

- Workforce sessions live in memory, so a restart signs everyone out.
- Workforce sessions carry no roles. The application's policy decides what each principal may do.
- Provider endpoints must be on the issuer's origin, because one destination reaches one origin.
- The plugin checks certificates for validity but does not issue or renew them. That stays with the site's own PKI.
- Install needs the application to compose the network plugin, which renders the service files.
- The WinSW wrapper executable is the site's to supply.
- No kiosk client mode exists yet.

## Dependencies

Framework:

- `@agent-native/contracts` and `@agent-native/runtime` (types);
- `@agent-native/adapters`: `cli`, and `row-storage` for the schema version an install migrates to;
- `@agent-native/host`: `plugin`, `plugin-manifest`, `manifest` and `components`;
- `@agent-native/kernel/instance` (`LOCAL_WORKSPACE`) and `@agent-native/kernel/build` (the best-before date);
- `@agent-native/agents/oidc` (ID-token verification);
- `@agent-native/bundle`, for bundle verification, admission and the trusted key and approval types.

External: `zod` for the policy schema, and `jose` for the provider's key set.

## Tests

```sh
bun test showcase/examples/field-service/test/hardening.test.ts showcase/examples/field-service/test/security.test.ts
bun test plugins/network
bun test apps/desktop/test/site-policy.test.ts
bun test plugins/site
```

Applications that compose the plugin exercise it:

- the field-service suites cover isolated defaults, profile floors, identity and mTLS;
- the network suite shows a connected policy refused without the network plugin;
- the desktop test covers the shipped deployment policy.

`test/install.test.ts` installs signed fixture bundles into a staged prefix. Their binaries run `test/fixtures/install-cli.ts`, an application composing this plugin and the network and audit plugins, with commands that queue and settle an effect. It covers:

- a first install refused without approval;
- the rendered unit, rules and modes;
- an upgrade that migrates the workspace before switching;
- a tampered release reported by `status`;
- a tampered bundle refused while `current` stays put;
- uninstall keeping data;
- the best-before date in `status`;
- a purge refused while an effect is pending, allowed once it settles, and forced with `--discard-undelivered`.

With `SITE_INSTALL_NATIVE=1`, as in the `site-install` CI job on Ubuntu, the install test also runs `systemd-analyze verify` on the unit and `nft -c -f` on the rules.

`test/policy.test.ts` resolves policies against a fixed catalog. It covers:

- CIDR matching;
- certificate validity at a chosen time;
- the isolated default and binding checks;
- a policy that does not match the schema, refused as `INVALID_INPUT` with each field named;
- profile floors and the site-hub listener;
- folder bindings;
- the workforce issuer rules;
- listener files loaded next to the policy.

`test/workforce.test.ts` signs in against a fake provider answered by the injected destination fetch. It covers:

- the redirect parameters and PKCE pair;
- a one-use state, sign-out and session expiry;
- refusals for another audience, an unverified email and a discovery document naming another issuer;
- which callers `external` admits.

`test/identity-provider.test.ts` signs in through the same routes against the stand-in provider, called in process. It covers the sign-in page and the principal, and refusals for an unknown person, a redirect off loopback and a code spent by a wrong verifier.

## Skills

- [deploy-to-site](skills/deploy-to-site/SKILL.md): writing and checking a deployment policy, building and installing a signed bundle, and exporting firewall rules.
- [decommission-an-application](skills/decommission-an-application/SKILL.md): a shelf life, draining and deciding effects, a purge that loses nothing, and removing the site from a fleet.

## References

- [Security and compliance](../../docs/security-and-compliance.md#deployment-policy)
- [Application lifecycle](../../docs/application-lifecycle.md)
- [Architecture](../../docs/architecture.md#host-plugins)
- [Security and compliance](../../docs/security-and-compliance.md#controls-and-plugins)
