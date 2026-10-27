# @agent-native/pattern-operations

`pattern-operations` runs the [base pattern](../base/README.md) on a site. It adds a versioned state migration and the site, network, audit and telemetry plugins. It imports the test requests module, handlers, policy and screens unchanged.

## Layer

Content (`patterns/*`). It trusts the framework, the base pattern and the four plugins it composes.

## Primitives

The pattern is one [application](../../docs/primitives.md#application). Next to the base pattern's module it composes:

- a [state migration](../../docs/primitives.md#state-migration) in `migrations.ts`. Version 2 renames the `sampleId`, `unit` and `tests` fields of an earlier test requests release to `sample`, `transformer` and `method`. Requests that the base pattern wrote pass unchanged;
- a [deployment policy](../../docs/primitives.md#deployment-policy), which the [site plugin](../../plugins/site/README.md) loads from the `site-policy` setting;
- the [egress guard](../../docs/primitives.md#egress-guard) of the [network plugin](../../plugins/network/README.md), which checks each telemetry export against the policy's `telemetry` destination;
- the [audit log](../../docs/primitives.md#audit-log) of the [audit plugin](../../plugins/audit/README.md), which records each guarded connection and adds the `audit verify` command;
- [telemetry](../../docs/primitives.md#telemetry) from the [telemetry plugin](../../plugins/telemetry/README.md), which exports command counts, durations and spans over OTLP/HTTP.

The site, network, audit and telemetry plugins are each a [host plugin](../../docs/primitives.md#host-plugin). None of them adds a screen or changes a test request operation.

## Entrypoints

| Import | Runs in | Holds |
| --- | --- | --- |
| `@agent-native/pattern-operations/manifest` | Browser and server | The test requests module and the four plugin manifests |
| `@agent-native/pattern-operations/application` | Server | `createTestRequestsOperationsApplication`, with the migrations and plugins |
| `@agent-native/pattern-operations/screens` | Browser | The base pattern's screens |
| `@agent-native/pattern-operations/migrations` | Server | `testRequestsMigrations`, state version 2 |

## Trust boundary

The base pattern's policy decides every test request operation. Telemetry sends operation identifiers, outcomes, durations and counts. It sends no sample, description, request identifier or principal. An export leaves only through the egress guard to the URL that the site policy binds to `telemetry`. Without that binding, exports fail, the plugin reports the reason in `status()`, and commands are unaffected.

The migration step is not compatible. Once a workspace is at version 2, storage refuses `patterns/base` on it. `migrate` runs the step on a checked copy and keeps the previous database next to the new one. Any write by this pattern's code also stores version 2, without the copy.

`site-policy.dev.json` binds `telemetry` to `http://127.0.0.1:4318`. For `bun run dev:web` and `bun run dev`, `dev.ts` sets `AGENT_NATIVE_SITE_POLICY` to it. When nothing listens on port 4318, `dev.ts` starts the `startCollector` stand-in from `@agent-native/telemetry/testing` there. An OpenTelemetry Collector already on that port receives the exports instead. An explicit `AGENT_NATIVE_SITE_POLICY` wins, and then no stand-in starts.

## Dependencies

`@agent-native/pattern-base`, `@agent-native/host`, `@agent-native/runtime`, `@agent-native/kernel`, `@agent-native/site`, `@agent-native/network`, `@agent-native/audit` and `@agent-native/telemetry`.

## Tests

```sh
bun test patterns/operations
```

- `test/migration.test.ts`: a workspace seeded from `test/fixtures/workspace-v1.json` has no version stamp and stores `sampleId`, `unit` and `tests`. `migrate --dry-run` reports the step from 1 to 2 and changes nothing. `migrate` renames the fields, stamps version 2 and refuses `patterns/base`. A workspace that `patterns/base` wrote opens with its requests unchanged.
- `test/telemetry.test.ts`: the `startCollector` stand-in receives the committed and denied `test-request.submit` counts. The exported data holds no sample, description, request identifier or principal, and the audit log records the export.
- `test/ui-bindings.test.ts`: every bound capability is referenced by a screen in this pattern or the base.

### Use

Run the pattern in the browser:

```sh
cd patterns/operations
bun run dev:web
```

Run the workspace commands from the repository root with this pattern as the application. `migrate` and `restore` need the host stopped, and `backup` runs beside it.

1. Set the application:

   ```sh
   export AGENT_NATIVE_APPLICATION=@agent-native/pattern-operations
   ```

2. Write a verified copy of the workspace database:

   ```sh
   bun run cli backup --workspace patterns/operations/.workspace --out test-requests.sqlite
   ```

3. Report the steps that would run, without changing the workspace:

   ```sh
   bun run cli migrate --workspace patterns/operations/.workspace --dry-run
   ```

4. Migrate. The previous database stays as `workspace.sqlite.before-migrate`:

   ```sh
   bun run cli migrate --workspace patterns/operations/.workspace
   ```

5. Replace the workspace database with the verified backup:

   ```sh
   bun run cli restore --workspace patterns/operations/.workspace --from test-requests.sqlite
   ```

6. Check the audit log's hash chain. The command exits with 10 when the chain is damaged or the log holds no events:

   ```sh
   bun run cli audit verify --log patterns/operations/.workspace/audit
   ```

## Skills

- [export-telemetry](../../plugins/telemetry/skills/export-telemetry/SKILL.md)
- [deploy-to-site](../../plugins/site/skills/deploy-to-site/SKILL.md)
- [add-capability](../../packages/runtime/skills/add-capability/SKILL.md)

## References

- [Patterns](../../docs/patterns.md)
- [Base pattern](../base/README.md)
- [Telemetry plugin](../../plugins/telemetry/README.md)
- [Site plugin](../../plugins/site/README.md)
- [Audit plugin](../../plugins/audit/README.md)
