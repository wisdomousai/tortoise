# Primitives

A primitive is a reusable, domain-neutral building block that an application composes instead of writing again. Each primitive exists because one or more [principles](principles.md) require it, and it cites them. If a primitive cannot name a principle, either it does not belong in the framework or a principle is missing.

The catalog covers `packages/*`, the reusable registry items in `apps/web` and the repository scripts that enforce principles. Domain code in `examples/*` is not cataloged here (P12). A domain concept moves into a primitive only when a second example needs it.

## Reading the catalog

| Column     | Meaning                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Primitive  | The concept an application author reaches for.                                                                                          |
| Principles | The principles it realizes.                                                                                                             |
| Location   | Source directory or directories.                                                                                                        |
| Symbols    | Public exports, or for registries and scripts the item's file name. `bun run check:principles` checks that each one exists at Location. |
| Status     | `implemented`, `partial` (some guarantees missing, listed in the linked doc) or `proposed` (no code yet; Location and Symbols are `—`). |

A status changes only with matching evidence in the [implementation ledger](implementation-status.md) (P15).

## Contract

| Primitive               | Principles | Location             | Symbols                                                   | Status      |
| ----------------------- | ---------- | -------------------- | --------------------------------------------------------- | ----------- |
| Capability              | P1, P2     | `packages/contracts` | `defineCapability`, `jsonSchema`, `PermissionRequirement` | implemented |
| Module                  | P3, P12    | `packages/contracts` | `defineModule`, `CapabilityModule`                        | implemented |
| Catalog                 | P1, P3     | `packages/contracts` | `buildCatalog`, `Catalog`, `CatalogOperation`             | implemented |
| Integration declaration | P8, P9     | `packages/contracts` | `IntegrationDeclaration`                                  | implemented |
| Protocol errors         | P2, P8     | `packages/contracts` | `ApplicationError`, `errorEnvelope`, `ErrorCode`          | implemented |

## Runtime

| Primitive                                                              | Principles | Location           | Symbols                                                         | Status      |
| ---------------------------------------------------------------------- | ---------- | ------------------ | --------------------------------------------------------------- | ----------- |
| Application (composition root)                                         | P3, P4     | `packages/runtime` | `createApplication`, `ApplicationOptions`                       | implemented |
| Handler                                                                | P4, P7     | `packages/runtime` | `createHandlerFactory`, `HandlerContribution`, `HandlerContext` | implemented |
| Module slicing and routed policy                                       | P3, P12    | `packages/runtime` | `sliceHandlers`, `composeAuthorization`, `authorizationRoute`   | implemented |
| Execution context and grant                                            | P5         | `packages/runtime` | `ExecutionContext`, `DelegationGrant`                           | implemented |
| Authorization port                                                     | P6, P13    | `packages/runtime` | `AuthorizationPort`, `AuthorizationRequest`, `Decision`         | implemented |
| Storage port                                                           | P7, P13    | `packages/runtime` | `Storage`, `createMemoryStorage`, `WorkspaceSnapshot`           | implemented |
| Receipt and journal                                                    | P7, P8     | `packages/runtime` | `CommandReceipt`, `ChangeEvent`, `EventBatch`                   | implemented |
| Outbox effect (`ctx.enqueue`, `ctx.settleEffect`, `ctx.releaseEffect`) | P7, P9     | `packages/runtime` | `Effect`, `EffectRequest`, `EffectOutcome`                      | implemented |

## Authority adapters

| Primitive                 | Principles | Location            | Symbols                                              | Status      |
| ------------------------- | ---------- | ------------------- | ---------------------------------------------------- | ----------- |
| Bounded policy scope      | P6, P13    | `packages/adapters` | `createScopedAbility`, `scopeToSql`, `validateScope` | implemented |
| SQLite snapshot storage   | P7, P13    | `packages/adapters` | `SQLiteStorage`                                      | implemented |
| Workspace ownership       | P4         | `packages/adapters` | `acquireWorkspaceOwnership`, `WorkspaceOwnedError`   | implemented |
| Grant file and connection | P5         | `packages/adapters` | `readGrantFile`, `readConnection`, `ConnectionFile`  | implemented |
| UI session and intent     | P5, P8     | `packages/adapters` | `UiSessionStore`, `UiIntent`, `CapturedUiContext`    | implemented |

## Surfaces

| Primitive        | Principles | Location            | Symbols                                    | Status      |
| ---------------- | ---------- | ------------------- | ------------------------------------------ | ----------- |
| HTTP/SSE adapter | P1, P5, P6 | `packages/adapters` | `createHttpHandler`                        | implemented |
| MCP adapter      | P1         | `packages/adapters` | `createMcpServer`, `toolInputSchema`       | implemented |
| CLI adapter      | P1, P8     | `packages/adapters` | `runCli`, `exitCodes`, `PENDING_EXIT_CODE` | implemented |
| Direct transport | P1, P4     | `packages/adapters` | `createDirectTransport`                    | implemented |

## Integration

| Primitive                            | Principles | Location               | Symbols                                                          | Status      |
| ------------------------------------ | ---------- | ---------------------- | ---------------------------------------------------------------- | ----------- |
| System-of-record port                | P9, P13    | `packages/integration` | `SystemOfRecordPort`, `LookupResult`, `TargetDescription`        | implemented |
| Effect dispatcher                    | P9, P8     | `packages/integration` | `createEffectDispatcher`, `DeliveryFailure`, `DeliveryUncertain` | partial     |
| Inbound sync                         | P9, P7     | `packages/integration` | `createInboundSync`, `PullBatch`                                 | implemented |
| Worker claims and fencing            | P9         | —                      | —                                                                | proposed    |
| Reconciliation of uncertain outcomes | P8, P9     | —                      | —                                                                | proposed    |

The dispatcher is partial: held effects exist, but claims, upstream-pending and cancel-before-dispatch do not. See the [system-of-record reference](system-of-record-pattern.md#status-against-the-reference-plan).

## Client and React

| Primitive                       | Principles | Location          | Symbols                                                    | Status      |
| ------------------------------- | ---------- | ----------------- | ---------------------------------------------------------- | ----------- |
| Typed client and live query     | P7, P8     | `packages/client` | `createClient`, `createHttpTransport`, `LiveQuery`         | implemented |
| Dependency-indexed invalidation | P7         | `packages/react`  | `createLiveBindings`, `isAffected`, `changedResourceTypes` | implemented |
| Capability form                 | P1, P8     | `packages/react`  | `useCapabilityForm`, `CapabilityFormOptions`               | implemented |
| Capture loop                    | P11, P15   | `packages/react`  | `useCaptureLoop`, `useCaptureTiming`, `useScannerInput`    | implemented |
| UI context capture              | P5, P8     | `packages/react`  | `captureUiContext`, `UiContext`                            | implemented |

## Agents and execution

| Primitive                      | Principles | Location          | Symbols                                       | Status      |
| ------------------------------ | ---------- | ----------------- | --------------------------------------------- | ----------- |
| Harness port                   | P10, P13   | `packages/agents` | `Harness`, `HarnessEvent`, `HarnessTurn`      | implemented |
| Run supervisor                 | P5, P8     | `packages/agents` | `createRunSupervisor`, `RunState`, `RunStore` | implemented |
| Credential vault               | P5         | `packages/agents` | `CredentialVault`, `OsCredentialVault`        | implemented |
| Deterministic harness          | P10, P15   | `packages/agents` | `deterministicHarness`                        | implemented |
| Execution host and tool broker | P5, P13    | —                 | —                                             | proposed    |

## Station bridge

| Primitive                  | Principles | Location           | Symbols                                                                                                                           | Status      |
| -------------------------- | ---------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Screen transport           | P9, P13    | `packages/station` | `ScreenTransport`, `createPlaywrightTransport`                                                                                    | implemented |
| Computer-use driver        | P10, P13   | `packages/station` | `ComputerUseDriver`, `createScriptedDriver`                                                                                       | implemented |
| Station connector and gate | P9, P10    | `packages/station` | `createStationConnector`, `BridgeControl`                                                                                         | implemented |
| Station observer           | P4, P8     | `packages/station` | `createStationObserver`, `StabilityGate`                                                                                          | implemented |
| Extractor and perception   | P8, P13    | `packages/station` | `Extractor`, `createPerception`, `createAccessibilityExtractor`, `createWorkerExtractor`, `createOpenAiCompatibleVisionExtractor` | implemented |
| Station profile            | P14        | `packages/station` | `StationProfile`, `stationProfileSchema`, `validateProfile`                                                                       | implemented |
| Golden gate                | P14, P15   | `packages/station` | `runGolden`, `GoldenReport`                                                                                                       | implemented |

## Devices

| Primitive                   | Principles    | Location           | Symbols                                                                                                | Status      |
| --------------------------- | ------------- | ------------------ | ------------------------------------------------------------------------------------------------------ | ----------- |
| Scanner profile             | P14           | `packages/devices` | `ScannerProfile`, `scannerProfileSchema`                                                               | implemented |
| Scanner source              | P11, P13      | `packages/devices` | `ScannerSource`, `createWedgeSource`, `createSerialSource`, `createHidPosSource`, `createCameraSource` | implemented |
| Decoding and calibration    | P11           | `packages/devices` | `decodeScan`, `calibrate`, `parseGs1`, `parseAim`                                                      | implemented |
| Scan router                 | P10, P11, P14 | `packages/devices` | `createScanRouter`, `ScanRoute`                                                                        | implemented |
| Device configuration module | P12, P14      | `packages/devices` | `deviceConfigModule`, `createDeviceHandlers`                                                           | implemented |

Scanner sources have no real-hardware evidence yet ([ledger](implementation-status.md#operator-workstation-bridge)).

## UI registries

| Primitive                      | Principles  | Location                  | Symbols                                                                                                                                                                                                                        | Status      |
| ------------------------------ | ----------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| Operator registry (`operator`) | P11, P12    | `packages/operator-ui`    | `operator-surface`, `big-action`, `tile-picker`, `numeric-pad`, `scan-prompt`, `status-strip`, `attention-queue`, `takeover-button`, `use-press-and-hold`, `use-tap-guard`, `use-feedback`, `use-operator-keys`, `use-scanner` | implemented |
| Capture kit registry           | P1, P8, P12 | `apps/web/src/components` | `capability-form`, `live-data-table`, `sync-status`, `conflict-banner`, `run-panel`, `command-palette`                                                                                                                         | implemented |

`capture-station` and `sync-status` in the capture kit still bind to quality-inspection contracts. They are starting points for a new domain, not finished primitives.

## Verification and delivery

| Primitive                           | Principles  | Location            | Symbols                                                                  | Status      |
| ----------------------------------- | ----------- | ------------------- | ------------------------------------------------------------------------ | ----------- |
| Behavioral scenario                 | P1, P6, P15 | `packages/testing`  | `BehavioralScenario`, `runScenarios`, `directDriver`, `assertEquivalent` | implemented |
| Generated artifacts and drift check | P1, P15     | `scripts`           | `generate`                                                               | implemented |
| Browser boundary check              | P2          | `scripts`           | `check-boundaries`, `boundary-rules`                                     | implemented |
| Principle catalog check             | P15         | `scripts`           | `check-principles`                                                       | implemented |
| Scaffolder                          | P12, P14    | `packages/scaffold` | `scaffold`, `ScaffoldManifest`                                           | implemented |
| Signed task package                 | P14, P15    | —                   | —                                                                        | proposed    |

## Adding or changing a primitive

1. Name the principles it realizes. If none fits, propose a principle first (see [keeping principles current](principles.md#keeping-this-current)).
2. Check that it is domain-neutral (P12). If only one example needs it, keep it in that example.
3. Prefer extending an existing primitive or extracting existing code over writing a new one.
4. Add or update its row here in the same change as the code. `bun run check:principles` fails when a listed symbol, location or principle ID no longer exists, when a package has no row, or when a principle has no implemented primitive.
5. Change Status only together with evidence in the [implementation ledger](implementation-status.md).
