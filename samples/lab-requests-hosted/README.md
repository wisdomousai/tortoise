# @agent-native/sample-lab-requests-hosted

`sample-lab-requests-hosted` runs the [lab requests sample](../lab-requests/README.md) unchanged as a [hosted instance](../../docs/glossary.md#hosted-instance): the lab's request desk, served from a Postgres database. Two instances of the workspace race for its [workspace lease](../../docs/glossary.md#workspace-lease), and the one that loses takes over when the holder stops. Lab staff sign in through [workforce sign-in](../../docs/glossary.md#workforce-sign-in), and the email the identity provider verified decides their role.

## Layer

Content (`samples/*`). It imports the base sample, the framework and the site and network plugins. The development launch and the tests also import the stand-in identity provider from `@agent-native/site/testing`.

## Primitives

The sample is one [application](../../docs/primitives.md#application). It composes:

- [host platform](../../docs/primitives.md#host-platform): the hosted platform, which `--hosted-workspace` selects at launch. The application itself names no database;
- [storage](../../docs/primitives.md#storage): `PostgresStorage` on a Postgres server in a development launch, and on PGlite in the tests;
- [workspace lease](../../docs/primitives.md#workspace-lease): one holder at a time, released on a clean stop;
- [deployment policy](../../docs/primitives.md#deployment-policy): `identity: external`, with the `workforce-idp` destination bound to the provider and its CA;
- [workforce sign-in](../../docs/primitives.md#workforce-sign-in): OpenID Connect with PKCE against the stand-in provider, which signs in the people in `labStaff`;
- [egress guard](../../docs/primitives.md#egress-guard): the host reaches the provider only through the bound destination.

Its own files:

| File | Runs in | Holds |
| --- | --- | --- |
| `manifest.ts` | Browser and server | The lab requests module, then the site and network plugin manifests |
| `application.ts` | Server | `labStaff`, the members keyed by email, and `createLabRequestsHostedApplication` |
| `screens.tsx` | Browser | The base sample's screens |
| `dev.ts` | Development launch | The stand-in provider on `https://127.0.0.1:4372`, and a policy that signs people in through it |

## Entrypoints

| Import | Runs in | Holds |
| --- | --- | --- |
| `@agent-native/sample-lab-requests-hosted/manifest` | Browser and server | The lab requests module and the two plugin manifests |
| `@agent-native/sample-lab-requests-hosted/application` | Server | `createLabRequestsHostedApplication` and `labStaff`; the default export is one with default options |
| `@agent-native/sample-lab-requests-hosted/screens` | Browser | The test request screens |

## Trust boundary

The database URL comes only from `AGENT_NATIVE_DATABASE_URL`, so its credentials stay out of the process list and the policy. Every commit checks the lease's fence in its transaction, so an instance that lost the lease commits nothing more.

Under `identity: external` the host has no owner session, no launch link and no connection file. The only way in is a sign-in at `/auth/sign-in`. The principal is the verified email, and the base sample's policy gives technicians the right to submit and viewers the right to read.

The stand-in provider is for development only. It signs in whoever is picked on its page, without a password. It redirects only to loopback, so it cannot sign anyone in to another host. A deployment binds `workforce-idp` to the organization's provider instead.

## Dependencies

`@agent-native/sample-lab-requests`, `@agent-native/site`, `@agent-native/network`, `@agent-native/runtime`, `@agent-native/host`, `@agent-native/frame`, and in tests `@agent-native/adapters`, `@agent-native/kernel` and `@agent-native/testing`. A development launch needs a Postgres 15 or newer server and a certificate for `127.0.0.1` that the browser trusts.

## Tests

```sh
bun test samples/lab-requests-hosted/
```

- `test/hosted.test.ts`:
  - Two instances on one PGlite database race for the workspace, and one is refused with `WorkspaceOwnedError`. The lease outlives its first expiry while the holder renews it. After the holder closes, a new instance lists the request the first one recorded and records another.
  - With `openssl` on the path: a throwaway CA, the stand-in provider over HTTPS, and a host under `identity: external` that trusts the CA. The host has no launch link or connection file. A technician signs in through the provider's page and submits a request recorded under their email. A viewer signs in, lists it, and is refused a submission.
- `test/ui-bindings.test.ts`: every bound capability is referenced by a screen in this sample or the base.

Run the sample on this machine:

1. Start a Postgres server the instance can create tables in, and put its URL in `AGENT_NATIVE_DATABASE_URL`.
2. Issue a certificate for `127.0.0.1` from a CA the browser trusts, such as mkcert's: `mkcert -install`, then `mkcert 127.0.0.1`.
3. Start the launch:

   ```sh
   cd samples/lab-requests-hosted
   LAB_IDP_CERT=<dir>/127.0.0.1.pem LAB_IDP_KEY=<dir>/127.0.0.1-key.pem \
     LAB_IDP_CA="$(mkcert -CAROOT)/rootCA.pem" bun run dev:web
   ```

4. Open the sign-in link the launch prints, pick `ana@lab.example`, and submit a test request. Sign in again as `ben@lab.example` to read it as a viewer. Workforce sessions live in memory, so a restart signs everyone out.
5. From the repository root, start a second instance of the same workspace:

   ```sh
   AGENT_NATIVE_APPLICATION=@agent-native/sample-lab-requests-hosted \
     bun run cli serve --workspace <dir>/instance-b --hosted-workspace lab-requests --port 4362
   ```

   It exits with code 5 and `CONFLICT` while the launch holds the lease. Stop the launch, and the same command takes over and serves the requests. Without `AGENT_NATIVE_SITE_POLICY` it runs as the local owner, and its connection file reaches it from the CLI.

The frame has no sign-out control. `POST /auth/sign-out` from the page's origin ends the session.

## Skills

- [run-a-hosted-instance](../../packages/host/skills/run-a-hosted-instance/SKILL.md)
- [deploy-to-site](../../plugins/site/skills/deploy-to-site/SKILL.md)

## References

- [Samples](../../docs/samples.md)
- [Hosting](../../docs/hosting.md#hosted-instance)
- [Site plugin](../../plugins/site/README.md)
- [Adapters: storage](../../docs/adapters.md#storage)
