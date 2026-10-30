---
name: run-a-hosted-instance
description: Run an agent-native application's instance on a server, with its workspace in Postgres under a lease that another instance can take over. Use when deploying a hosted instance (no site requirements), choosing between local SQLite and Postgres storage, setting AGENT_NATIVE_DATABASE_URL and serve --hosted-workspace, putting public TLS ingress and workforce OIDC sign-in in front of it, or writing a new Storage adapter and proving it with the storage conformance suite. Covers hostedPlatform in packages/host, PostgresStorage and acquireWorkspaceLease in packages/adapters, and storageConformance in packages/testing.
---

# Run a hosted instance

A hosted instance is the same host on another host platform. `hostedPlatform` keeps the workspace in a shared Postgres database and makes ownership a workspace lease with a fencing token. A replacement instance can take over, and a paused old one commits nothing more. Contracts and handlers do not change.

## Before writing

- Check that the application can be hosted. A `site`-scoped destination, a device, an exchange folder or a station process pins it to a site. The generated security manifest (`bun run generate`) shows its placement.
- Decide the instance layout. One process serves one workspace. Several workspaces run one instance each, behind a router that sends each workspace's requests to its instance.
- `showcase/patterns/hosted` is a hosted instance with workforce sign-in against a stand-in provider, and its test races two instances on PGlite.
- Decide where the instance's local directory (`--workspace`) lives. It still holds blobs, agent run history, the audit log and the plugins' files. Put it on a volume that follows the instance, or accept that a takeover on another machine starts without them.

## Steps

### Hosted instance

1. Provide a Postgres 15 or newer database the instance can create tables in. The adapter refuses a database written by another storage schema version (`STORAGE_SCHEMA_VERSION`, 3), so a workspace from an earlier version starts in a new database.
2. Put the database URL with its credentials in `AGENT_NATIVE_DATABASE_URL`, from the deployment's secret store. Never put it in a flag or a policy file.
3. Start the instance with `app serve --workspace <dir> --hosted-workspace <name> --port <n>`. `<name>` is the workspace's key in the database, and every instance of one workspace uses the same name. A second instance is refused with `CONFLICT` while the lease is held. A development launch takes the same flag: `bun ../../scripts/dev-example.ts --port <n> --hosted-workspace <name>` from the application's directory.
4. Supervise the instance and restart it when it exits. An instance that loses its lease logs a `lease-lost` record on stderr and exits with code 1. A restarted instance does not wait for the lease. It is refused until the lease expires after 30 seconds without renewal, or is released.
5. Set a `tls` listener with the public certificate in the site plugin's policy, as for a site. The `deploy-to-site` skill (`plugins/site/skills/deploy-to-site/SKILL.md`) has the policy steps.
6. Set `identity: external` in the same policy, with `workforce` naming the OpenID Connect provider. People sign in with the workforce account, and no local owner session exists.
7. Back up with the database's own tools, such as `pg_dump` or point-in-time recovery. The CLI's `backup`, `restore`, `migrate`, `sync`, `drain` and `--embedded` verbs open a local workspace only.

### Storage adapter

1. Implement `Storage<State>` with `transact` and `read`. A Postgres-compatible database can reuse `PostgresStorage` with its own `PgDriver`.
2. Prove it with `storageConformance(harness)` from `@agent-native/testing/storage`, as `packages/testing/test/storage.test.ts` does for memory, SQLite and Postgres.

## Checks

```sh
bun test packages/testing/test/storage.test.ts packages/testing/test/postgres-lease.test.ts packages/host/test/hosted-platform.test.ts
STORAGE_POSTGRES_URL=postgres://... bun test packages/testing/test/storage.test.ts packages/testing/test/postgres-lease.test.ts
```

The second line runs the same cases against a real server, with a database made for the run. Report it, and any run of a hosted instance, as by-hand evidence in `docs/implementation-status.md`. The `check-a-change` skill (`packages/testing/skills/check-a-change/SKILL.md`) covers the rest.

## References

- [Hosting](../../../../docs/hosting.md#hosted-instance)
- [Adapters](../../../../docs/adapters.md#storage)
- [Hosted pattern](../../../../showcase/patterns/hosted/README.md)
