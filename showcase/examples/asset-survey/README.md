# Asset survey hub

A survey manager builds a site structure and sends an assignment to a person or a paired phone. The assignee photographs equipment and nameplates, a reviewer checks the values read from the photos, and a manager files the accepted data to an enterprise asset management system (EAM). The [field application](../asset-survey-field/README.md) runs on the phone and exchanges assignments and reports with this hub.

```sh
cd showcase/examples/asset-survey
bun run dev:web
```

## What to try

- Build a structure (port 4326), send an assignment to yourself and capture a nameplate from [`fixtures/nameplates`](fixtures/nameplates.ts). The fake extractor reads text embedded in the demo images, not the pixels.
- Review the extracted values and file the node to the fake EAM; its sample assets are `EAM-1001` (`=G1-Q1`, active) and `EAM-1002` (`=G1-F2`, retired).
- Create an enrollment code on **Devices** and pair a phone running the field application.
- A vision-model extractor needs an explicitly configured model, key and `model-api` binding ([`connectors/model-extractor.ts`](connectors/model-extractor.ts)).

## References

- [Assignments](../../../docs/assignments.md)
- Real parts and stand-ins: [implementation status](../../../docs/implementation-status.md)
- `bun test showcase/examples/asset-survey`, `bunx playwright test showcase/examples/asset-survey/e2e`
