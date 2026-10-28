# Operate and migrate the lab desk

The operations pattern runs the [base oil-lab desk](../base/README.md) with site policy, audit and [telemetry](../../../docs/primitives.md#telemetry) plugins. A state migration upgrades an older request shape. Lab commands and screens stay the same while the host applies the operational controls.

## Run the desk

From the repository root:

```sh
cd showcase/patterns/operations
bun run dev:web
```

The development policy sends telemetry to `127.0.0.1:4318`. When nothing listens there, the development launch starts a stand-in collector; an explicitly configured site policy takes precedence.

## Migration and telemetry

Version 2 in [`migrations.ts`](migrations.ts) renames the old `sampleId`, `unit` and `tests` fields to `sample`, `transformer` and `method`. A base-pattern workspace whose records already use the new fields passes unchanged. The migration is incompatible with the old code: once the workspace is at version 2, the base pattern refuses to open it.

Telemetry exports operation identifiers, outcomes, durations and counts through the policy-bound network port. It excludes sample values, descriptions, request IDs and principals. A missing destination makes export fail but does not stop lab commands.

## Back up and migrate a workspace

Run the workspace commands from the repository root with this pattern as the application. `migrate` and `restore` need the host stopped, and `backup` runs beside it.

1. Set the application:

   ```sh
   export AGENT_NATIVE_APPLICATION=@agent-native/pattern-operations
   ```

2. Write a verified copy of the workspace database:

   ```sh
   bun run cli backup --workspace showcase/patterns/operations/.workspace --out test-requests.sqlite
   ```

3. Report the steps that would run, without changing the workspace:

   ```sh
   bun run cli migrate --workspace showcase/patterns/operations/.workspace --dry-run
   ```

4. Migrate. The previous database stays as `workspace.sqlite.before-migrate`:

   ```sh
   bun run cli migrate --workspace showcase/patterns/operations/.workspace
   ```

5. Replace the workspace database with the verified backup:

   ```sh
   bun run cli restore --workspace showcase/patterns/operations/.workspace --from test-requests.sqlite
   ```

6. Check the audit log's hash chain. The command exits with 10 when the chain is damaged or the log holds no events:

   ```sh
   bun run cli audit verify --log showcase/patterns/operations/.workspace/audit
   ```

## Checks

```sh
bun test showcase/patterns/operations
```

The migration test checks a dry run, the conversion and refusal by older code. The telemetry test uses a stand-in collector and checks the exported fields; it is not evidence of a live collector deployment.
