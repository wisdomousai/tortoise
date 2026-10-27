# @agent-native/fleet-agent

The site side of a [fleet](../../docs/glossary.md#fleet). A site's [instance](../../docs/glossary.md#instance) composes this plugin to report its health to a fleet application, forward its [audit log](../../docs/glossary.md#audit-log) there and stage the releases the fleet assigns. The plugin can also let the fleet relay remote-access requests to the site's own HTTP API. Every connection is outbound through the network port's `fleet` [destination](../../docs/glossary.md#destination), so the site needs no inbound rule.

## Layer

Plugins (`plugins/*`). Server only, except `contracts` and `plugin-manifest`.

## Primitives

- [Fleet agent](../../docs/primitives.md#fleet-agent): `createFleetAgentPlugin`, `fleetAgentPlugin`, `fleetAgentPluginManifest` and the protocol module `fleetSiteModule`.

## Entrypoints

| Import | Runs in | Contents |
| --- | --- | --- |
| `@agent-native/fleet-agent` | server | The `contracts`, `plugin-manifest` and `plugin` exports. |
| `@agent-native/fleet-agent/contracts` | browser-safe | The protocol capabilities, `fleetSiteModule`, `fleetSiteOperationIds`, the report, release and relay schemas, `fleetLinkComponent`. |
| `@agent-native/fleet-agent/plugin-manifest` | browser-safe | `fleetAgentPluginManifest`: the destination, the folder and the settings. |
| `@agent-native/fleet-agent/plugin` | server | `createFleetAgentPlugin`, `fleetAgentPlugin`, the service and status types. |
| `@agent-native/fleet-agent/testing` | server (tests) | `fleetNetworkFixture`: a network plugin whose `fleet` destination goes through a test's function. |

A fleet composes `fleetSiteModule`, implements its handlers and enrolls sites with the [device-link plugin](../device-link/README.md). Each site is a `field-sync` device whose sync capabilities are `fleetSiteOperationIds`.

### Settings

Compose the plugin after the site plugin, the network plugin and, for audit forwarding, the audit plugin. The [deployment policy](../../docs/glossary.md#deployment-policy) binds the `fleet` destination to the fleet's https origin and the `fleet-releases` folder to a directory. Both bindings are optional, and the site runs without them. The destination is declared `authenticated`, so the site check refuses a plain-text binding off loopback.

| Setting | Environment | Meaning |
| --- | --- | --- |
| `fleet-enrollment-code` | `AGENT_NATIVE_FLEET_ENROLLMENT_CODE` | One-use code from the fleet, exchanged for the site credential on the first cycle. |
| `fleet-trust` | `AGENT_NATIVE_FLEET_TRUST` | Release signing keys (`key.pub.json` or an array). Without them, releases are not staged. |
| `fleet-relay` | `AGENT_NATIVE_FLEET_RELAY` | `on` forwards remote-access requests. The default is off. |

`createFleetAgentPlugin({ intervalMs, relayMs })` sets the cycle and the relay poll, one minute and two seconds by default. The service at `services['fleet-agent']` offers `status()`, `sync()` and `relay()`.

## Trust boundary

- **Fleet outages.** The plugin writes nothing to the workspace. A failed cycle records its reason in `status().lastError`, and the site keeps committing and delivering while the fleet is unreachable.
- **Reports.** The plugin reads the outbox with the host's trusted identity (`pendingEffects`). Only [effect](../../docs/glossary.md#effect) counts per target leave the site, with the build's [best-before date](../../docs/glossary.md#best-before-date) from the open context when it has one. `examples/fleet/test/fleet.test.ts` covers the date reaching the fleet.
- **Audit forwarding.** The site keeps no forwarding state and sends events unchanged, so the fleet can check the hash chain.
- **Releases.** Each file is checked against the signed manifest as it arrives, and the whole bundle is verified with `verifyBundle` against `fleet-trust`. Only then is the temporary directory renamed into `fleet-releases/<release id>`.
- **Activation.** Activation stays with the site operator's `site install`. The instance never replaces itself.
- **Relay.** The relay forwards a request to the host's own listener under `/api/v1/` only and adds no credential. A relayed request reaches a [capability](../../docs/glossary.md#capability) only with a [session](../../docs/glossary.md#session) the site issued ([hosting](../../docs/hosting.md#relay)).
- **Relay exemption.** `scripts/boundary-rules.ts` lists `src/relay.ts` as a reviewed exemption from the [egress guard](../../docs/glossary.md#egress-guard), because its only target is the host itself.
- **Fleet credential.** The plugin sends the credential only through the network port's `fleet` client, which resolves every path against the bound origin and refuses redirects. The credential is kept in the platform's secret store when it has one, and otherwise in `<workspace>/fleet-agent/credential` with mode 0600.

The relay polls instead of holding a stream open, and handles one request at a time with bodies up to 1 MiB. The credential is not rotated, so a fleet that loses it re-enrolls the site with a new code.

## Dependencies

Framework: `@agent-native/bundle`, `@agent-native/contracts`, `@agent-native/event-log`, `@agent-native/host` and `@agent-native/kernel`. External: `zod`.

## Tests

```sh
bun test plugins/fleet-agent
```

`test/fleet-agent.test.ts` starts a fixture fleet and a site on loopback. The fleet composes device link and `fleetSiteModule`. The site composes the site and audit plugins and this plugin, with a network fixture that can go offline, drop a reply or corrupt a download. The test covers:

- enrollment, and outbox reports without payloads;
- a site with no code;
- audit forwarding with a lost reply;
- a site that keeps committing while the fleet is unreachable, then reports the backlog;
- a release changed in transit or at the fleet, which never reaches the folder;
- a relay that answers 403 without a credential or with the fleet credential, and 200 with a session the site issued.

The upgrade test installs version 1 of the site with `site install` and runs it with two effects queued for an unreachable [system of record](../../docs/glossary.md#system-of-record). It stages the 2.0.0 release the fleet assigns. The installed release's binary then runs `site install` on the staged folder. The new binary migrates the workspace before `current` switches. The effects stay pending with contract version 1 recorded, and version 2 then queues its own. The test's releases run `test/site-cli.ts`.

## Skills

- [connect-a-site-to-a-fleet](skills/connect-a-site-to-a-fleet/SKILL.md): composing the plugin, enrolling a site, staging releases and turning on the relay.

## References

- [Hosting](../../docs/hosting.md#fleet)
- [Hosting](../../docs/hosting.md#fleet-agent)
