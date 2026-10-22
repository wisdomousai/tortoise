# @agent-native/sample-notes-operations

`sample-notes-operations` runs the [notes sample](../notes/README.md) on a site. It adds a versioned state migration and the site, network, audit and telemetry plugins. It imports the notes module, handlers, policy and screens unchanged.

## Layer

Content (`samples/*`). It trusts the framework, the base sample and the four plugins it composes.

## Primitives

The sample is one [application](../../docs/primitives.md#application). Next to the base sample's module it composes:

- a [state migration](../../docs/primitives.md#state-migration) in `migrations.ts`. Version 2 renames the `body` field that an earlier notes release stored to `text`. The step is not compatible, so after `migrate` storage refuses `samples/notes` on that workspace. Notes already stored as `text` pass unchanged;
- the [site plugin](../../plugins/site/README.md), which loads the deployment policy from the `site-policy` setting;
- the [network plugin](../../plugins/network/README.md), whose egress guard checks each telemetry export against the policy's `telemetry` destination;
- the [audit plugin](../../plugins/audit/README.md), which records each guarded connection;
- the [telemetry plugin](../../plugins/telemetry/README.md), which exports command counts, durations and spans over OTLP/HTTP.

None of the plugins adds a screen or changes a note operation.

## Entrypoints

| Import | Runs in | Holds |
| --- | --- | --- |
| `@agent-native/sample-notes-operations/manifest` | Browser and server | The notes module and the four plugin manifests |
| `@agent-native/sample-notes-operations/application` | Server | `createNotesOperationsApplication`, with the migrations and plugins |
| `@agent-native/sample-notes-operations/screens` | Browser | The base sample's screens |
| `@agent-native/sample-notes-operations/migrations` | Server | `notesMigrations`, state version 2 |

## Trust boundary

The base sample's policy decides every note operation. Telemetry sends operation identifiers, outcomes, durations and counts; it sends no note text, record identifier or principal. An export leaves only through the egress guard to the URL that the site policy binds to `telemetry`. Without that binding, exports fail, the plugin reports the reason in `status()`, and commands are unaffected.

`site-policy.dev.json` binds `telemetry` to `http://127.0.0.1:4318`, a local OpenTelemetry Collector. `dev.ts` sets `AGENT_NATIVE_SITE_POLICY` to it for `bun run dev:web` and `bun run dev`, unless the variable is already set.

## Dependencies

`@agent-native/sample-notes`, `@agent-native/host`, `@agent-native/runtime`, `@agent-native/kernel`, `@agent-native/site`, `@agent-native/network`, `@agent-native/audit` and `@agent-native/telemetry`.

## Tests

```sh
bun test samples/notes-operations
```

- `test/migration.test.ts`: a workspace seeded from `test/fixtures/workspace-v1.json` has no version stamp and stores `body`. `migrate --dry-run` reports the step from 1 to 2 and changes nothing. `migrate` renames the field, stamps version 2 and refuses `samples/notes`. A workspace that `samples/notes` wrote opens with its notes unchanged.
- `test/telemetry.test.ts`: a loopback collector receives the committed and denied `note.add` counts. The exported data holds no title, text, note identifier or principal, and the audit log records the export.
- `test/ui-bindings.test.ts`: every bound capability is referenced by a screen in this sample or the base.

Migrate a workspace from the command line:

```sh
AGENT_NATIVE_APPLICATION=@agent-native/sample-notes-operations \
  bun apps/service/src/cli.ts migrate --workspace samples/notes-operations/.workspace --dry-run
```

Run the sample in the browser:

```sh
cd samples/notes-operations
bun run dev:web
```

## Skills

- [export-telemetry](../../plugins/telemetry/skills/export-telemetry/SKILL.md)
- [deploy-to-site](../../plugins/site/skills/deploy-to-site/SKILL.md)
- [add-capability](../../packages/runtime/skills/add-capability/SKILL.md)

## References

- [Samples](../../docs/samples.md)
- [Notes sample](../notes/README.md)
- [Telemetry plugin](../../plugins/telemetry/README.md)
- [Site plugin](../../plugins/site/README.md)
