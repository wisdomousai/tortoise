# Operate and migrate the lab desk

This pattern adds operational host plugins and a state migration to the hypothetical [base application](../base/README.md). The migration renames the original request fields into the versioned schema used by this application. The unchanged base cannot subsequently open that newer workspace.

Telemetry sends configured measurements through its bound network destination. An unavailable collector records an export failure while local application commands remain available. The commands below exercise workspace maintenance against the selected application.

```sh
cd showcase/patterns/operations
bun run dev:web
```

## What to try

The development policy sends telemetry to `127.0.0.1:4318`; when nothing listens there, the launch starts a stand-in collector.

Set `TORTOISE_APPLICATION=@tortoise/pattern-operations` and pass `--workspace showcase/patterns/operations/.workspace` to the workspace commands: `bun run cli backup --out test-requests.sqlite` while the host runs; with the host stopped, `bun run cli migrate --dry-run`, then `migrate` (the old database stays as `workspace.sqlite.before-migrate`) and `restore --from test-requests.sqlite`.

`bun run cli audit verify --log showcase/patterns/operations/.workspace/audit` exits 10 on a damaged or empty chain.

## References

[Deployment and operation](../../../docs/hosting.md)

[Security and compliance](../../../docs/security-and-compliance.md)

[export-telemetry](../../../plugins/telemetry/skills/export-telemetry/SKILL.md)

`bun test showcase/patterns/operations`
