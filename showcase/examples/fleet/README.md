# Fleet for instance applications

This hypothetical fleet application receives reports from enrolled instances and assigns signed releases through channels. The fleet-agent protocol supplies the instance-facing operations. This application adds the screens and policy used to manage those records.

```sh
cd showcase/examples/fleet
bun run dev:web
```

## Application policy

The local user starts as an operator. Operators can publish a release and assign its channel. Instance removal and relay requests additionally require a person. Viewers have read access. Enrolled devices use the scoped instance protocol without receiving a workspace role.

The Health screen derives issues from stored reports. A report older than 15 minutes is stale. Forwarded audit more than 1,000 events behind the reported head produces an audit-behind issue. Held effects and a broken audit chain are reported directly. The screen also reports release drift and a passed best-before date. These are this application's choices in [handlers/instances.ts](handlers/instances.ts).

Audit ingestion verifies the forwarded chain. A detected break records `auditBroken`, and later ingestion returns the existing cursor without accepting further events for that record. The application retains the newest 1,000 forwarded events per instance. Removing an instance leaves its audit history intact. Revoke the device credential before removing the instance record; a still-enrolled device can report again and recreate it.

## Release delivery

The fleet validates uploaded release blobs against the bundle manifest. The receiving fleet agent checks its configured trust keys before staging the signed release. A fleet failure does not stop local execution at an enrolled instance. Staging requires a later installation command to activate the release.

To publish over HTTP, upload each payload file to `/api/v1/blobs` using an operator session and `Content-Type: application/octet-stream`. Call `release.publish` with the parsed bundle manifest and signature plus the resulting blob references. `channel.assign` then selects that release for a channel. The [fleet-agent pattern](../../patterns/fleet-agent/README.md) contains a local publication script and fixture setup.

## Development

The application starts on port 4340. Create an enrollment code on Devices before connecting an instance. Its Health screen reflects the reports received through that connection.

Run `bun test showcase/examples/fleet` from the repository root. Tests use loopback instances through `fleetNetworkFixture`; their results do not establish a deployed fleet connection. The [operational guide](../../../docs/hosting.md#fleet) describes the framework protocol. Dated execution evidence remains in [Implementation status](../../../docs/implementation-status.md#fleet-agent).
