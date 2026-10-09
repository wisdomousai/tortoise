# 006 — Applications run at the edge, beside the work

Accepted. Serves [P12](../principles.md#p12--applications-run-beside-the-work). The concept is described in [edge applications](../edge-applications.md).

**Context.** The target applications record work at a machine and deal with the software that controls it, often vendor software with a long lifecycle. That software is reachable through local interfaces, files, protocols or its screen, and each route needs code on or near the machine. Agent harnesses also run locally. Plant networks are segmented, and links to enterprise systems can be slow or down.

**Decision.**

- **Placement.** The application runs on the machine's PC, an edge box beside it, or a line host, and one process owns each workspace. Desktop and compiled CLI builds are the distribution forms.
- **Commit path.** A command commits locally and never waits for a system of record, a wider network or a model. Upstream delivery is queued with visible state, and inbound sync resumes where it stopped.
- **Agents** on the edge host are callers of the running application through the CLI or MCP, with a grant-bound connection the host issues. An agent can therefore run as another OS user without the owner's credential.
- **Control software** is reached through edge adapters behind ports. Prefer structured routes to pixels, reads to writes, and supported interfaces to reverse-engineered ones. Writes are declared procedures with readback ([ADR 004](004-screen-mediated-authority.md)).
- **Models** propose and deterministic code acts. Every task keeps a path that needs no inference, and model endpoints are explicit configuration.

**Consequences.**

- A hosted multi-tenant deployment is not the default. No central service drives control software inside a plant network.
- Each edge host needs its own installation, update, identity and containment story. Fleet updates, per-operator identity at shared stations and a credential broker are not provided.
- Old machines that cannot run the host need an edge box.
- Offline operation means a local commit plus a queued outbox. It has not been exercised on a disconnected device.
