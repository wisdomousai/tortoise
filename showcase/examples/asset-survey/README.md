# Asset survey hub

This hypothetical survey application sends site assignments to a person or paired phone. A capture contains equipment observations and attached photos. A reviewer checks extracted values before accepted data is filed to the configured EAM port.

The [field application](../asset-survey-field/README.md) supplies the phone-side worklist. The development EAM and photo extractor are fixtures. Their behavior does not establish the behavior of an external EAM or vision model.

```sh
cd showcase/examples/asset-survey
bun run dev:web
```

## What to try

Build a structure (port 4326), send an assignment to yourself and capture a nameplate from [`fixtures/nameplates`](fixtures/nameplates.ts). The fake extractor reads text metadata embedded in the demo images.

Review the extracted values and file the node to the fake EAM; its sample assets are `EAM-1001` (`=G1-Q1`, active) and `EAM-1002` (`=G1-F2`, retired).

Create an enrollment code on **Devices** and pair a phone running the field application.

A vision-model extractor needs an explicitly configured model, key and `model-api` binding ([`connectors/model-extractor.ts`](connectors/model-extractor.ts)).

## References

[Assignments](../../../docs/assignments.md)

Real parts and stand-ins: [implementation status](../../../docs/implementation-status.md)

`bun test showcase/examples/asset-survey`, `bunx playwright test showcase/examples/asset-survey/e2e`
