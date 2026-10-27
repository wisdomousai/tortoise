# @agent-native/sample-lab-requests-operations

`sample-lab-requests-operations` runs the [lab requests sample](../lab-requests/README.md) on a site. It adds a versioned state migration and the site, network, audit and telemetry plugins. It imports the lab requests module, handlers, policy and screens unchanged.

## Layer

Content (`samples/*`). It trusts the framework, the base sample and the four plugins it composes.

## Primitives

The sample is one [application](../../docs/primitives.md#application). Next to the base sample's module it composes:

- a [state migration](../../docs/primitives.md#state-migration) in `migrations.ts`. Version 2 renames the `sampleId` and `tests` fields of an earlier lab requests release to `specimen` and `method`. Requests that the base sample wrote pass unchanged;
- a [deployment policy](../../docs/primitives.md#deployment-policy), which the [site plugin](../../plugins/site/README.md) loads from the `site-policy` setting;
- the [egress guard](../../docs/primitives.md#egress-guard) of the [network plugin](../../plugins/network/README.md), which checks each telemetry export against the policy's `telemetry` destination;
- the [audit log](../../docs/primitives.md#audit-log) of the [audit plugin](../../plugins/audit/README.md), which records each guarded connection and adds the `audit verify` command;
- [telemetry](../../docs/primitives.md#telemetry) from the [telemetry plugin](../../plugins/telemetry/README.md), which exports command counts, durations and spans over OTLP/HTTP.

The site, network, audit and telemetry plugins are each a [host plugin](../../docs/primitives.md#host-plugin). None of them adds a screen or changes a test request operation.

## Entrypoints

| Import | Runs in | Holds |
| --- | --- | --- |
| `@agent-native/sample-lab-requests-operations/manifest` | Browser and server | The lab requests module and the four plugin manifests |
| `@agent-native/sample-lab-requests-operations/application` | Server | `createLabRequestsOperationsApplication`, with the migrations and plugins |
| `@agent-native/sample-lab-requests-operations/screens` | Browser | The base sample's screens |
| `@agent-native/sample-lab-requests-operations/migrations` | Server | `labRequestsMigrations`, state version 2 |

## Trust boundary

The base sample's policy decides every test request operation. Telemetry sends operation identifiers, outcomes, durations and counts. It sends no specimen, description, request identifier or principal. An export leaves only through the egress guard to the URL that the site policy binds to `telemetry`. Without that binding, exports fail, the plugin reports the reason in `status()`, and commands are unaffected.

The migration step is not compatible. Once a workspace is at version 2, storage refuses `samples/lab-requests` on it. `migrate` runs the step on a checked copy and keeps the previous database next to the new one. Any write by this sample's code also stores version 2, without the copy.

`site-policy.dev.json` binds `telemetry` to `http://127.0.0.1:4318`. For `bun run dev:web` and `bun run dev`, `dev.ts` sets `AGENT_NATIVE_SITE_POLICY` to it. When nothing listens on port 4318, `dev.ts` starts the `startCollector` stand-in from `@agent-native/telemetry/testing` there. An OpenTelemetry Collector already on that port receives the exports instead. An explicit `AGENT_NATIVE_SITE_POLICY` wins, and then no stand-in starts.

## Dependencies

`@agent-native/sample-lab-requests`, `@agent-native/host`, `@agent-native/runtime`, `@agent-native/kernel`, `@agent-native/site`, `@agent-native/network`, `@agent-native/audit` and `@agent-native/telemetry`.

## Tests

```sh
bun test samples/lab-requests-operations
```

- `test/migration.test.ts`: a workspace seeded from `test/fixtures/workspace-v1.json` has no version stamp and stores `sampleId` and `tests`. `migrate --dry-run` reports the step from 1 to 2 and changes nothing. `migrate` renames the fields, stamps version 2 and refuses `samples/lab-requests`. A workspace that `samples/lab-requests` wrote opens with its requests unchanged.
- `test/telemetry.test.ts`: the `startCollector` stand-in receives the committed and denied `test-request.submit` counts. The exported data holds no specimen, description, request identifier or principal, and the audit log records the export.
- `test/ui-bindings.test.ts`: every bound capability is referenced by a screen in this sample or the base.

### Use

Run the sample in the browser:

```sh
cd samples/lab-requests-operations
bun run dev:web
```

Run the workspace commands from the repository root with this sample as the application. `migrate` and `restore` need the host stopped, and `backup` runs beside it.

1. Set the application:

   ```sh
   export AGENT_NATIVE_APPLICATION=@agent-native/sample-lab-requests-operations
   ```

2. Write a verified copy of the workspace database:

   ```sh
   bun run cli backup --workspace samples/lab-requests-operations/.workspace --out lab-requests.sqlite
   ```

3. Report the steps that would run, without changing the workspace:

   ```sh
   bun run cli migrate --workspace samples/lab-requests-operations/.workspace --dry-run
   ```

4. Migrate. The previous database stays as `workspace.sqlite.before-migrate`:

   ```sh
   bun run cli migrate --workspace samples/lab-requests-operations/.workspace
   ```

5. Replace the workspace database with the verified backup:

   ```sh
   bun run cli restore --workspace samples/lab-requests-operations/.workspace --from lab-requests.sqlite
   ```

6. Check the audit log's hash chain. The command exits with 10 when the chain is damaged or the log holds no events:

   ```sh
   bun run cli audit verify --log samples/lab-requests-operations/.workspace/audit
   ```

## Skills

- [export-telemetry](../../plugins/telemetry/skills/export-telemetry/SKILL.md)
- [deploy-to-site](../../plugins/site/skills/deploy-to-site/SKILL.md)
- [add-capability](../../packages/runtime/skills/add-capability/SKILL.md)

## References

- [Samples](../../docs/samples.md)
- [Lab requests sample](../lab-requests/README.md)
- [Telemetry plugin](../../plugins/telemetry/README.md)
- [Site plugin](../../plugins/site/README.md)
- [Audit plugin](../../plugins/audit/README.md)
