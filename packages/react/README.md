# @agent-native/react

React bindings that turn a person's intent into exactly one command and keep committed data live on screen. Forms validate with the capability's own schema and keep one idempotency key per intent. Live queries follow the journal through TanStack Query with an authorization fence. Capture helpers time and route point-of-work input, and UI-context helpers hand an agent exactly what the person selected.

Layer: framework (`packages/*`). Browser-safe.

## Primitives

- [Capability binding](../../docs/primitives.md#capability-binding): `useCapabilityForm`, `useCommand`, `useLiveQuery`.
- [Remote query](../../docs/primitives.md#remote-query): `remoteQueryOptions` and `remoteInfiniteQueryOptions` from `createLiveBindings`, and `REMOTE_STALE_MS`.
- [Journal and live query](../../docs/primitives.md#journal-and-live-query): `createLiveBindings`, `changedResourceTypes`, `isAffected`.
- [UI session context](../../docs/primitives.md#ui-session-context): `captureUiContext`, `UiSessions`, `UiContext`, `UiIntent`.

The [interaction contract](../../docs/interaction-contract.md) defines drafts, conflicts and intents. The quality-inspection capture screen ([`examples/quality-inspection/ui/capture-station.tsx`](../../examples/quality-inspection/ui/capture-station.tsx)) uses the form and capture bindings together.

## Entrypoints

| Import                        | Runs in | Contents                                                                                              |
| ----------------------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `@agent-native/react`         | browser | `useLiveQuery`, `useCommand`, `captureUiContext`, `UiSessions`.                                       |
| `@agent-native/react/*`       | browser | One source file, listed below; the root re-exports `hooks` and `ui-context`.                          |
| `@agent-native/react/form`    | browser | `useCapabilityForm`: a TanStack Form bound to one command capability.                                 |
| `@agent-native/react/query`   | browser | `createLiveBindings`: TanStack Query bindings for one authenticated transport.                        |
| `@agent-native/react/capture` | browser | `useScannerInput`, `useCaptureTiming`, `useCaptureLoop`, and `ScanDetector` re-exported from devices. |

`query.ts` is the entry module over `src/query/`, which is imported only from inside the package: `keys` holds the cache key root, query metadata and the fence interface; `live` the options for local queries; and `remote` the options for remote queries, single-result and paged. `createLiveBindings` passes them its transport and authorization fence.

## Trust boundary

Nothing here is a security boundary; the authority still authorizes and validates. The bindings protect correctness on the client:

- `useCapabilityForm` mints the idempotency key when the form opens and reuses it for every retry until commit, so double taps and scanner double-sends record once. Mapped input is frozen per attempt, so a retry replays the original receipt. Server field errors land on the field; a `CONFLICT` keeps the draft.
- `createLiveBindings` serves one session (one authority, principal and grant); discard it on sign-out. A snapshot produced under an older authorization revision than the stream has seen is rejected instead of cached, and a permission change clears cached data before refetching. `remoteQueryOptions` results are not refetched by change batches, because that would call the other system on every commit, but a permission change clears them too.
- A captured UI context is an immutable snapshot of the selection and observed revisions, never ambient authority. Intents never write business records.

## Dependencies

Framework: `@agent-native/contracts`, `@agent-native/client`, `@agent-native/devices` (wedge detection). External: `react`, `@tanstack/react-query`, `@tanstack/react-form`.

## Tests

```sh
bun test packages/react
```

- `src/bindings.test.ts`: dependency-indexed refetch, permission changes clear the cache (also behind a hung refetch and for data cached before the stream's first batch), a remote query ignores local changes, keeps its abort signal and resets on a permission change; a paged remote query sends each page's `next` back and stops without one; and scanner bursts are told apart from typing.
- `src/context.test.ts`: captured targets stay fixed after selection changes; session routing, acknowledgement and stale registrations.
