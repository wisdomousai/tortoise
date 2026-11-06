---
name: run-a-hosted-instance
description: Deploy an instance with Postgres workspace storage under a database lease. Use for hosted-platform configuration and workforce sign-in, or when implementing a storage adapter and checking its conformance.
---

# Run a hosted instance

`hostedPlatform` opens a workspace in Postgres under a database lease. Each commit checks the lease's fencing token. A replacement instance can acquire an expired lease; the old owner's next commit fails after ownership changes. Review the application's requirements before selecting this platform.

## Before writing

- Check that the application can be hosted. A `local`-scoped destination, a device, an exchange folder or a station process pins it to one location. The generated security manifest (`bun run generate`) shows its placement.
- Decide the instance layout. One process serves one workspace. Several workspaces run one instance each, behind a router that sends each workspace's requests to its instance.
- Decide where the instance's local directory (`--workspace`) lives. It still contains agent run history, workforce sessions, the audit log and the plugins' files; blobs are stored in the database. Put it on a volume that follows the instance, or accept that a takeover on another machine starts without them.

## Steps

### Hosted instance

1. Provide a Postgres 15 or newer database the instance can create tables in. The adapter refuses a database written by another storage schema version. Review the stored-data transition and required backup before creating a replacement database.
2. Put the database URL with its credentials in `TORTOISE_DATABASE_URL`, from the deployment's secret store. Never put it in a flag or a policy file.
3. Start the instance with `app serve --workspace <dir> --hosted-workspace <name> --port <n>`. `<name>` is the workspace's key in the database, and every instance of one workspace uses the same name. A second instance is refused with `CONFLICT` while the lease is held. A development launch takes the same flag: `bun ../../scripts/dev-example.ts --port <n> --hosted-workspace <name>` from the application's directory.
4. Supervise the instance and restart it when it exits. An instance that loses its lease logs a `lease-lost` record on stderr and exits with code 1. A restarted instance does not wait for the lease. It is refused until the lease expires after 30 seconds without renewal, or is released.
5. Set a `tls` listener with the public certificate in the deployment plugin's policy, as for any other host. The `deploy-an-application` skill (`plugins/deployment/skills/deploy-an-application/SKILL.md`) has the policy steps.
6. Set `identity: external` in the same policy, with `workforce` naming the OpenID Connect provider. People sign in with the workforce account, and no local user session exists.
7. Back up with the database's own tools, such as `pg_dump` or point-in-time recovery. The CLI's `backup`, `restore`, `migrate`, `sync`, `drain` and `--embedded` verbs open a local workspace only.

### Storage adapter

1. Implement `Storage<State>` with `transact` and `read`. A Postgres-compatible database can reuse `PostgresStorage` with its own `PgDriver`.
2. Run `storageConformance(harness)` from `@tortoise/testing/storage`, as `packages/testing/test/storage.test.ts` does for memory, SQLite and Postgres.

## Checks

```sh
bun test packages/testing/test/storage.test.ts packages/testing/test/postgres-lease.test.ts packages/host/test/hosted-platform.test.ts
STORAGE_POSTGRES_URL=postgres://... bun test packages/testing/test/storage.test.ts packages/testing/test/postgres-lease.test.ts
```

The second line runs the same cases against a real server, with a database made for the run. Report it, and any run of a hosted instance, as by-hand evidence in `docs/implementation-status.md`. The `check-a-change` skill (`packages/testing/skills/check-a-change/SKILL.md`) covers the rest.

## References

- [Deployment and operation](../../../../docs/hosting.md#hosted-instance)
- [Architecture](../../../../docs/architecture.md#storage)
