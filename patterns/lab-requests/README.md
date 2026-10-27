# @agent-native/pattern-lab-requests

`pattern-lab-requests` is the base application of the [patterns](../../docs/patterns.md): a lab's test requests. A technician submits a request for a specimen with a description of what to test and assigns the test method, and viewers read the requests. Each extension pattern imports its module, handlers, policy and screens unchanged and adds one concern next to them.

## Layer

Content (`patterns/*`). It composes no plugins, and it trusts only the framework.

## Primitives

The pattern is one [application](../../docs/primitives.md#application), run by an [instance](../../docs/primitives.md#instance) on the default SQLite [storage](../../docs/primitives.md#storage). It composes:

- one [module](../../docs/primitives.md#module), `lab-requests`, with a [collection](../../docs/primitives.md#collection) of test requests, the generated `test-request.list` and `test-request.get` [queries](../../docs/primitives.md#query), and the `test-request.submit` and `test-request.update` [commands](../../docs/primitives.md#command);
- [display metadata](../../docs/primitives.md#display-metadata) on the collection and commands, which titles the MCP tools and the screens;
- a workflow, `lab-requests.assign-method`, that the MCP resource `app://workflows/lab-requests.assign-method` and the generated application skill serve to agents;
- a [policy](../../docs/primitives.md#policy) with technician and viewer roles, applied to the `labRequests` state slice through `composeAuthorization`;
- [capability bindings](../../docs/primitives.md#capability-binding): the frame's `CollectionScreen` and `RecordScreen` over the generated reads, which follow them as [live queries](../../docs/primitives.md#journal-and-live-query).

The same capabilities reach the CLI and MCP through the [surface adapters](../../docs/primitives.md#surface-adapter), and `bun run generate` writes their [catalog](../../docs/primitives.md#catalog) reference to `dist/reference/lab-requests/`.

## Entrypoints

| Import | Runs in | Holds |
| --- | --- | --- |
| `@agent-native/pattern-lab-requests/manifest` | Browser and server | `defineManifest` with the `lab-requests` module |
| `@agent-native/pattern-lab-requests/application` | Server | `createLabRequestsApplication`, the `labRequests` slice, handlers and policy |
| `@agent-native/pattern-lab-requests/screens` | Browser | The test request list and the test request screen |
| `@agent-native/pattern-lab-requests/server` | Server | What an extension imports: module, handlers, policy and state |
| `@agent-native/pattern-lab-requests/ui/requests` | Browser | `requestRoutes({ sections })`, `requestNavigation` and `requestCapabilityScreens` |

## Trust boundary

The policy's caller gate admits only principals listed in `members`. `test-request.submit` and `test-request.update` need the technician role, and every other operation is denied. A change that passes `expectedRevisions` older than the request's revision fails with `CONFLICT` inside the transaction.

## Dependencies

`@agent-native/contracts`, `@agent-native/runtime`, `@agent-native/host` and `@agent-native/frame`.

## Tests

```sh
bun test patterns/lab-requests/
```

- `test/requests.test.ts`: behavioral scenarios through `directDriver` on the embedded instance. They cover submitting a request and assigning its method, a stale revision, a replayed idempotency key and refused callers.
- `test/headless.test.ts`: the starter's CLI submits and lists test requests with `--embedded`, and an MCP client lists one tool per capability, reads the workflow and calls `test_request_submit`.
- `test/ui-bindings.test.ts`: every bound capability is referenced by a screen.

Run the pattern in the browser:

```sh
cd patterns/lab-requests
bun run dev:web
```

## Skills

- [add-capability](../../packages/runtime/skills/add-capability/SKILL.md)
- [build-screens](../../packages/frame/skills/build-screens/SKILL.md)

## References

- [Patterns](../../docs/patterns.md)
- [Capability authoring](../../docs/capability-authoring.md)
- [Interaction contract](../../docs/interaction-contract.md)
- [Authorization](../../docs/authorization.md)
