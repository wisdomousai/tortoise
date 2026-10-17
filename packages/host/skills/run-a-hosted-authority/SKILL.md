---
name: run-a-hosted-authority
description: Run an agent-native application's authority on a server, with its workspace in Postgres under a lease that another instance can take over. Use when deploying a hosted instance (no site requirements), choosing between local SQLite and Postgres storage, setting AGENT_NATIVE_DATABASE_URL and serve --hosted-workspace, putting public TLS ingress and workforce OIDC sign-in in front of it, or writing a new Storage adapter and proving it with the storage conformance suite. Covers hostedPlatform in packages/host, PostgresStorage and acquireWorkspaceLease in packages/adapters, and storageConformance in packages/testing.
---

# Run a hosted authority

A hosted authority is the same host on another platform: `hostedPlatform` keeps the workspace in a shared Postgres database and makes ownership a lease with a fencing token, so a replacement instance can take over and a paused old one commits nothing more. Contracts and handlers do not change. The [host README](../../README.md#trust-boundary) states what the lease guarantees; the [ledger](../../../../docs/implementation-status.md#hosted-authority) lists what is not built.

## Before writing

- Check the application can be hosted: a `site`-scoped destination, a device, an exchange folder or a station process pins it to a site, and the generated security manifest (`bun run generate`) shows its placement.
- Decide the instance layout. One process serves one workspace. Several workspaces run one instance each, behind a router that sends each workspace's requests to its instance.
- The instance's local directory (`--workspace`) still holds blobs, agent run history, the audit log and the plugins' files. Put it on a volume that follows the instance, or accept that a takeover on another machine starts without them.

## Steps

1. **Provide the database**: a Postgres 15 or newer database the instance can create tables in. Its URL with credentials goes in `AGENT_NATIVE_DATABASE_URL`, from the deployment's secret store, never a flag or a policy file.
2. **Start the instance** with `app serve --workspace <dir> --hosted-workspace <name> --port <n>`. `<name>` is the workspace's key in the database; every instance of one workspace uses the same name. A second instance is refused with `CONFLICT` while the lease is held.
3. **Supervise it**: an instance that loses its lease exits with code 1 and logs a `lease-lost` record on stderr. Restart it; it waits for no one, but is refused until the lease expires (30 seconds without renewal) or is released.
4. **Put ingress and identity in front** with the site plugin's policy, as for a site (the `deploy-to-site` skill, `plugins/site/skills/deploy-to-site/SKILL.md`): a `tls` listener with the public certificate, and `identity: external` with `workforce` naming the OpenID Connect provider, so people sign in with the workforce account and no local owner session exists.
5. **Back up** with the database's own tools (`pg_dump`, point-in-time recovery). The CLI's `backup`, `restore`, `migrate`, `sync`, `drain` and `--embedded` verbs open a local workspace only.

## A new storage adapter

Implement `Storage<State>` (`transact`, `read`) and prove it with `storageConformance(harness)` from `@agent-native/testing/storage`, as `packages/testing/test/storage.test.ts` does for memory, SQLite and Postgres. A Postgres-compatible service can reuse `PostgresStorage` with its own `PgDriver`.

## Checks

```sh
bun test packages/testing/test/storage.test.ts packages/testing/test/postgres-lease.test.ts packages/host/test/hosted-platform.test.ts
STORAGE_POSTGRES_URL=postgres://... bun test packages/testing/test/storage.test.ts packages/testing/test/postgres-lease.test.ts
```

The second line runs the same cases against a real server, with a database made for the run. Report it, and any run of a hosted instance, as by-hand evidence in `docs/implementation-status.md`. The `check-a-change` skill (`packages/testing/skills/check-a-change/SKILL.md`) covers the rest.
