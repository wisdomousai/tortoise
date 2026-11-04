# Operate and migrate the lab desk

This pattern runs the [base lab desk](../base/README.md) with the deployment policy, audit and telemetry plugins and adds a state migration: version 2 renames `sampleId`, `unit` and `tests` to `sample`, `transformer` and `method`, after which the base pattern refuses to open the workspace. Telemetry exports operation identifiers, outcomes, durations and counts through the bound network port and leaves out sample values, descriptions, request IDs and principals; a missing destination fails the export but not the lab's commands.

```sh
cd showcase/patterns/operations
bun run dev:web
```

## What to try

- The development policy sends telemetry to `127.0.0.1:4318`; when nothing listens there, the launch starts a stand-in collector.
- Set `TORTOISE_APPLICATION=@tortoise/pattern-operations` and pass `--workspace showcase/patterns/operations/.workspace` to the workspace commands: `bun run cli backup --out test-requests.sqlite` while the host runs; with the host stopped, `bun run cli migrate --dry-run`, then `migrate` (the old database stays as `workspace.sqlite.before-migrate`) and `restore --from test-requests.sqlite`.
- `bun run cli audit verify --log showcase/patterns/operations/.workspace/audit` exits 10 on a damaged or empty chain.

## References

- [Application lifecycle](../../../docs/application-lifecycle.md)
- [Security and compliance](../../../docs/security-and-compliance.md)
- [export-telemetry](../../../plugins/telemetry/skills/export-telemetry/SKILL.md)
- `bun test showcase/patterns/operations`
