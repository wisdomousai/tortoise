---
'@agent-native/contracts': minor
'@agent-native/runtime': minor
'@agent-native/integration': minor
'@agent-native/adapters': minor
'@agent-native/kernel': minor
'@agent-native/host': minor
'@agent-native/shell': minor
'@agent-native/mobile': minor
'@agent-native/frame': minor
'@agent-native/frame-native': minor
'@agent-native/react': minor
'@agent-native/devices': minor
'@agent-native/observation': minor
'@agent-native/operator-ui': minor
'@agent-native/scaffold': minor
'@agent-native/agents': minor
'@agent-native/screen-bridge': minor
'@agent-native/workstation-sign-in': minor
'@agent-native/connector-driver': minor
'@agent-native/connector-files': minor
'@agent-native/connector-http': minor
'@agent-native/connector-mqtt': minor
'@agent-native/connector-opcua': minor
'@agent-native/automation': minor
'@agent-native/audit': minor
'@agent-native/compliance': minor
'@agent-native/fleet-agent': minor
'@agent-native/peer-link': minor
'@agent-native/telemetry': minor
'@agent-native/site': minor
'@agent-native/notifications': minor
'@agent-native/os': minor
'@agent-native/share-target': minor
'@agent-native/android-intents': minor
'@agent-native/execution-host': minor
'@agent-native/hub-link': minor
'@agent-native/workflows': minor
---

Plain names for identifiers, capability IDs, stored fields and UI copy that used metaphors.

Breaking changes:

- Storage schema version 3. The SQLite, Postgres and snapshot adapters refuse a workspace written by an earlier version, with a message that names the renamed fields. Start with a new data directory. Row storage and snapshot storage each refuse a file that holds the other's tables.
- Effect completion: `ctx.settleEffect` and `settledEffect` are `ctx.completeEffect` and `completedEffect`. A target's `<target>.effect.settle` is `<target>.effect.complete`, with the permission action `complete`. The connectors' `settleOperation` option, the notifications plugin's `settleOperationOf` and `TargetSpec.settles` are `completeOperation`, `completeOperationOf` and `TargetSpec.changes`. The stored `settledAt` is `completedAt`, the audit kind `effect.settled` is `effect.completed`, and completion idempotency keys start with `complete:`.
- The effect phase `upstream` is `acknowledged`. `upstreamAt`, `upstreamRef` and `UpstreamPending` are `acknowledgedAt`, `externalRef` and `DeliveryAcknowledged`. `DispatchReport.upstream`, the fleet report's `outbox.upstream` and the OTLP state `upstream` are `acknowledged`. `UpstreamVersions` is `SourceVersions`.
- Integration allowlists: `IntegrationLane`, `peerLane` and `targetLane` are `IntegrationAllowlist`, `peerAllowlist` and `targetAllowlist`. The dispatcher's `tally` is `countAs`.
- Driver protocol types: `InitializeAnswer`, `StateAnswer`, `InvokeAnswer` and `LookupAnswer` are `InitializeResult`, `StateResult`, `InvokeResult` and `ActionLookupResult`. `SourceAnswer` is `SourceResult`. The JSON on the wire is unchanged.
- Risk level: `HazardClass`, the `hazard` field of driver actions and procedures, and `hazardSchema` are `RiskLevel`, `risk` and `riskSchema`. Driver contracts and station profiles name the field `risk`. The values are unchanged.
- Screen bridge: `Perception`, `createPerception` and the `@agent-native/screen-bridge/perception` entrypoints are `Recognizer`, `createRecognizer` and `@agent-native/screen-bridge/recognition`. The perception worker is the recognition worker, and `STATION_PERCEPTION_WORKER` is `STATION_RECOGNITION_WORKER`. The control holder (`ControlHolder`, `BridgeControl.holder`) replaces the seat.
- Workstation sign-in: a seat is a terminal. The setting `station-sign-in-seats` is `station-sign-in-terminals`, `AGENT_NATIVE_STATION_SIGN_IN_SEATS` is `AGENT_NATIVE_STATION_SIGN_IN_TERMINALS`, the screen is at `/terminal`, and `stationSignInScreens` takes `terminal`.
- Observation: `StabilityGate`, `gateReadings` and `GatedField` are `Debouncer`, `debounceReadings` and `DebouncedField`.
- Trigger grants: `standingGrantSchema`, `StandingGrant` and the resource type `standing-grant` are `triggerGrantSchema`, `TriggerGrant` and `trigger-grant`.
- Fleet relay: `fleet.relay.answer` and `fleet.relay.take` are `fleet.relay.respond` and `fleet.relay.claim`. Relay requests are `queued`, `claimed` or `responded`.
- OS requests: the browser landing page is the launch page (`serveOsLaunchPage`), and the desktop and phone relays reply through `respond`.
- The identity provider from `@agent-native/site/testing` (`createIdentityProvider`, `startIdentityProvider`) returns `respond` in place of `answer`.
