---
'@tortoise/contracts': minor
'@tortoise/runtime': minor
'@tortoise/integration': minor
'@tortoise/adapters': minor
'@tortoise/kernel': minor
'@tortoise/host': minor
'@tortoise/shell': minor
'@tortoise/mobile': minor
'@tortoise/frame': minor
'@tortoise/frame-native': minor
'@tortoise/react': minor
'@tortoise/devices': minor
'@tortoise/observation': minor
'@tortoise/operator-ui': minor
'@tortoise/scaffold': minor
'@tortoise/agents': minor
'@tortoise/screen-bridge': minor
'@tortoise/workstation-sign-in': minor
'@tortoise/connector-driver': minor
'@tortoise/connector-files': minor
'@tortoise/connector-http': minor
'@tortoise/connector-mqtt': minor
'@tortoise/connector-opcua': minor
'@tortoise/automation': minor
'@tortoise/audit': minor
'@tortoise/compliance': minor
'@tortoise/fleet-agent': minor
'@tortoise/peer-link': minor
'@tortoise/telemetry': minor
'@tortoise/deployment': minor
'@tortoise/notifications': minor
'@tortoise/os': minor
'@tortoise/share-target': minor
'@tortoise/android-intents': minor
'@tortoise/execution-host': minor
'@tortoise/hub-link': minor
'@tortoise/workflows': minor
---

Plain names for identifiers, capability IDs, stored fields and UI copy that used metaphors.

Breaking changes:

- Storage schema version 3. The SQLite, Postgres and snapshot adapters refuse a workspace written by an earlier version, with a message that names the renamed fields. Start with a new data directory. Row storage and snapshot storage each refuse a file that contains the other's tables.
- Effect completion: `ctx.settleEffect` and `settledEffect` are `ctx.completeEffect` and `completedEffect`. A target's `<target>.effect.settle` is `<target>.effect.complete`, with the permission action `complete`. The connectors' `settleOperation` option, the notifications plugin's `settleOperationOf` and `TargetSpec.settles` are `completeOperation`, `completeOperationOf` and `TargetSpec.changes`. The stored `settledAt` is `completedAt`, the audit kind `effect.settled` is `effect.completed`, and completion idempotency keys start with `complete:`.
- The effect phase `upstream` is `acknowledged`. `upstreamAt`, `upstreamRef` and `UpstreamPending` are `acknowledgedAt`, `externalRef` and `DeliveryAcknowledged`. `DispatchReport.upstream`, the fleet report's `outbox.upstream` and the OTLP state `upstream` are `acknowledged`. `UpstreamVersions` is `SourceVersions`.
- Integration allowlists: `IntegrationLane`, `peerLane` and `targetLane` are `IntegrationAllowlist`, `peerAllowlist` and `targetAllowlist`. The dispatcher's `tally` is `countAs`.
- Driver protocol types: `InitializeAnswer`, `StateAnswer`, `InvokeAnswer` and `LookupAnswer` are `InitializeResult`, `StateResult`, `InvokeResult` and `ActionLookupResult`. `SourceAnswer` is `SourceResult`. The JSON on the wire is unchanged.
- Risk level: `HazardClass`, the `hazard` field of driver actions and procedures, and `hazardSchema` are `RiskLevel`, `risk` and `riskSchema`. Driver contracts and station profiles name the field `risk`. The values are unchanged.
- Screen bridge: `Perception`, `createPerception` and the `@tortoise/screen-bridge/perception` entrypoints are `Recognizer`, `createRecognizer` and `@tortoise/screen-bridge/recognition`. The perception worker is the recognition worker, and `STATION_PERCEPTION_WORKER` is `STATION_RECOGNITION_WORKER`. The control holder (`ControlHolder`, `BridgeControl.holder`) replaces `seat`.
- Workstation sign-in: `seat` is now terminal. The setting `station-sign-in-seats` is `station-sign-in-terminals`, `TORTOISE_STATION_SIGN_IN_SEATS` is `TORTOISE_STATION_SIGN_IN_TERMINALS`, the screen is at `/terminal`, and `stationSignInScreens` takes `terminal`.
- Observation: `StabilityGate`, `gateReadings` and `GatedField` are `Debouncer`, `debounceReadings` and `DebouncedField`.
- Trigger grants: `standingGrantSchema`, `StandingGrant` and the resource type `standing-grant` are `triggerGrantSchema`, `TriggerGrant` and `trigger-grant`.
- Fleet relay: `fleet.relay.answer` and `fleet.relay.take` are `fleet.relay.respond` and `fleet.relay.claim`. Relay requests are `queued`, `claimed` or `responded`.
- OS requests: the browser `landing` page is the launch page (`serveOsLaunchPage`), and the desktop and phone relays reply through `respond`.
- The identity provider from `@tortoise/deployment/testing` (`createIdentityProvider`, `startIdentityProvider`) returns `respond` in place of `answer`.
