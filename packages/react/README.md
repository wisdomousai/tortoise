# @agent-native/react

React bindings that turn a [person's](../../docs/glossary.md#person) intent into exactly one [command](../../docs/glossary.md#command) and keep committed data live on a [screen](../../docs/glossary.md#screen). Forms validate with the [capability's](../../docs/glossary.md#capability) own schema and keep one [idempotency key](../../docs/glossary.md#idempotency-key) per intent. [Live queries](../../docs/glossary.md#live-query) follow the [journal](../../docs/glossary.md#journal) through TanStack Query behind an authorization fence. Capture helpers time and route point-of-work input, and UI-context helpers hand an agent exactly what the person selected.

## Layer

Framework (`packages/*`). Browser-safe. The bindings trust the [instance](../../docs/glossary.md#instance) to authorize and validate.

## Primitives

- [Capability binding](../../docs/primitives.md#capability-binding): `useCapabilityForm`, `useCommand`, `useLiveQuery`.
- [Remote query](../../docs/primitives.md#remote-query): `remoteQueryOptions` and `remoteInfiniteQueryOptions` from `createLiveBindings`, and `REMOTE_STALE_MS`.
- [Journal and live query](../../docs/primitives.md#journal-and-live-query): `createLiveBindings`, `changedResourceTypes`, `isAffected`.
- [UI session context](../../docs/primitives.md#ui-session-context): `captureUiContext`, `UiSessions`, `UiContext`, `UiIntent`.

The [interaction contract](../../docs/interaction-contract.md) defines drafts, conflicts and intents. The quality-inspection capture screen ([`examples/quality-inspection/ui/capture-station.tsx`](../../examples/quality-inspection/ui/capture-station.tsx)) uses the form and capture bindings together.

## Entrypoints

| Import                        | Runs in | Contents                                                                                  |
| ----------------------------- | ------- | ----------------------------------------------------------------------------------------- |
| `@agent-native/react`         | browser | `useLiveQuery`, `useCommand`, `captureUiContext`, `UiSessions`.                           |
| `@agent-native/react/*`       | browser | One source file from `src/`. The root re-exports `hooks` and `ui-context`.              |
| `@agent-native/react/form`    | browser | `useCapabilityForm`: a TanStack Form bound to one command capability.                     |
| `@agent-native/react/query`   | browser | `createLiveBindings`: TanStack Query bindings for one authenticated transport.            |
| `@agent-native/react/capture` | browser | `useScannerInput`, `useCaptureTiming`, `useCaptureLoop`, and `ScanDetector` from devices. |

## Trust boundary

Nothing here is a security boundary. The bindings protect correctness on the client.

`useCapabilityForm` mints the idempotency key when the form opens. It reuses the key for every retry until commit, so double taps and scanner double-sends record once. Mapped input is frozen per attempt, so a retry replays the original [receipt](../../docs/glossary.md#receipt). Server field errors land on the field, and a `CONFLICT` keeps the draft.

`createLiveBindings` serves one session: one instance, [principal](../../docs/glossary.md#principal) and [grant](../../docs/glossary.md#grant). Discard it on sign-out. The fence works like this:

- A [snapshot](../../docs/glossary.md#snapshot) produced under an older authorization revision than the stream has seen is rejected instead of cached.
- A permission change clears cached data before refetching.
- Change batches do not refetch `remoteQueryOptions` results, because each refetch would call the other system on every commit. A permission change clears them too.

A captured UI context is an immutable snapshot of the selection and observed revisions. It grants no permission. Intents do not write business records.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/client`, `@agent-native/devices` (wedge detection). External: `react`, `@tanstack/react-query`, `@tanstack/react-form`.

## Tests

```sh
bun test packages/react
```

- `src/bindings.test.ts`:
  - dependency-indexed refetch;
  - a permission change clears the cache, also behind a hung refetch and for data cached before the stream's first batch;
  - a remote query ignores local changes, keeps its abort signal and resets on a permission change;
  - a paged remote query sends each page's `next` back and stops without one;
  - scanner bursts are told apart from typing.
- `src/context.test.ts`: captured targets stay fixed after selection changes; session routing, acknowledgement and stale registrations.

## Skills

- [build-screens](../frame/skills/build-screens/SKILL.md): screens, forms, live queries and registry items.
